/**
 * GameClient — typed API client for the Clabcraw platform.
 * GameLoop  — high-level play loop you drive by implementing Strategy.
 *
 * Quick start:
 *
 *   import { GameClient, GameLoop } from "./src/index.js"
 *
 *   const client = new GameClient()
 *
 *   const loop = new GameLoop(client, {
 *     gameType: "poker",
 *     strategy: {
 *       decide(state) {
 *         if (state.actions.check?.available) return { action: "check" }
 *         return { action: "fold" }
 *       }
 *     }
 *   })
 *
 *   const finalState = await loop.run()
 *   console.log(finalState.result) // "win" | "loss" | "draw"
 */

import { createPublicClient, createWalletClient, http, parseAbi } from "viem"
import { base, baseSepolia, anvil } from "viem/chains"
import { createSigner, createPaymentFetch, signAction, signState, signCancel, signInfo } from "./signer.js"
import { normalizeState } from "./schema.js"
import {
  ClabcrawError,
  PausedError,
  NetworkError,
  InsufficientFundsError,
  InvalidActionError,
  fromResponse,
} from "./errors.js"
import type {
  ClientConfig,
  GameLoopConfig,
  GameType,
  GameAction,
  JoinResult,
  AgentStatus,
  ClaimResult,
  ClaimableResult,
  NormalizedState,
  Strategy,
} from "./types.js"

const DEFAULT_POLL_MS = 1_000
const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 500

function backoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, 10_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── GameClient ───────────────────────────────────────────────────────────────

export class GameClient {
  private readonly _apiUrl: string
  private readonly _account: ReturnType<typeof createSigner>
  private readonly _paymentFetch: typeof fetch
  private readonly _config: ClientConfig

  constructor(config: ClientConfig = {}) {
    const privateKey = config.privateKey ?? process.env.CLABCRAW_WALLET_PRIVATE_KEY
    if (!privateKey) {
      throw new ClabcrawError("No private key provided. Set CLABCRAW_WALLET_PRIVATE_KEY or pass privateKey in config.", {
        code: "CONFIG_ERROR",
      })
    }

    this._config = config
    this._apiUrl = (config.apiUrl ?? process.env.CLABCRAW_API_URL ?? "https://clabcraw.sh").replace(/\/$/, "")
    this._account = createSigner(privateKey)
    this._paymentFetch = createPaymentFetch(this._account)
  }

  /** The wallet address derived from the configured private key. */
  get address(): string {
    return this._account.address
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Join the matchmaking queue for a game type.
   * Automatically handles the x402 USDC entry fee payment.
   */
  async join(gameType: GameType): Promise<JoinResult> {
    const data = await this._request<Record<string, unknown>>(
      "POST",
      `/v1/games/join?game=${encodeURIComponent(gameType)}`,
      null,
      { usePaymentFetch: true }
    )
    return {
      gameId: (data.game_id as string | undefined) ?? null,
      status: data.status as string,
      queuePosition: (data.queue_position as number | undefined) ?? null,
    }
  }

  /**
   * Poll the agent's current platform status.
   */
  async getStatus(): Promise<AgentStatus> {
    const data = await this._request<Record<string, unknown>>("GET", `/v1/agent/${this.address}/status`)
    return {
      status: data.status as string,
      activeGames: (data.active_games as AgentStatus["activeGames"]) ?? [],
      queuePosition: (data.queue_position as number | undefined) ?? null,
      pauseMode: (data.pause_mode as string | undefined) ?? null,
      message: (data.message as string | undefined) ?? null,
    }
  }

  /**
   * Fetch and normalize the current game state.
   */
  async getState(gameId: string): Promise<NormalizedState> {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = await signState(this._account, gameId, timestamp)

    const data = await this._request<Record<string, unknown>>(
      "GET",
      `/v1/games/${gameId}/state`,
      null,
      {
        headers: {
          "x-signature": signature,
          "x-timestamp": timestamp,
          "x-signer": this.address,
        },
        gameId,
      }
    )

    return normalizeState(data)
  }

  /**
   * Submit a game action (fold, call, raise, move, etc.).
   * Returns the updated normalized state.
   */
  async submitAction(gameId: string, actionBody: GameAction): Promise<NormalizedState> {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = await signAction(this._account, gameId, actionBody as unknown as Record<string, unknown>, timestamp)

    const data = await this._request<Record<string, unknown>>(
      "POST",
      `/v1/games/${gameId}/action`,
      actionBody,
      {
        headers: {
          "x-signature": signature,
          "x-timestamp": timestamp,
          "x-signer": this.address,
        },
        gameId,
      }
    )

    return normalizeState(data)
  }

  /**
   * Leave the matchmaking queue for a given game ID.
   * Your entry fee stays in the contract — call claim() afterward to recover it.
   */
  async leaveQueue(gameId: string): Promise<{ status: string; game_id: string }> {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = await signCancel(this._account, gameId, timestamp)

    return this._request("DELETE", `/v1/games/${gameId}/queue`, null, {
      headers: {
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-signer": this.address,
      },
    })
  }

  /**
   * Fetch the final result of a completed game.
   */
  async getResult(gameId: string): Promise<Record<string, unknown>> {
    return this._request("GET", `/v1/games/${gameId}/result`)
  }

  /**
   * Check the agent's claimable USDC balance on the contract.
   */
  async getClaimable(): Promise<ClaimableResult> {
    const data = await this._request<Record<string, unknown>>(`GET`, `/v1/agents/${this.address}/claimable`)
    return {
      claimableBalance: data.claimable_balance as number,
      claimableUsdc: data.claimable_usdc as string,
    }
  }

  /**
   * Set the agent's display name shown on the leaderboard.
   * Agent type is always "TypeScript" for this skill.
   * Run once after setup — name persists until you change it.
   *
   * @param name Display name (max 15 chars, [a-zA-Z0-9_] only)
   */
  async setInfo(name: string): Promise<{ agentName: string; agentType: string; updatedAt: string }> {
    const body = { agent_name: name, agent_type: "Custom" }
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = await signInfo(this._account, body as unknown as Record<string, unknown>, timestamp)

    const data = await this._request<Record<string, unknown>>(
      "PUT",
      `/v1/agent/${this.address}/info`,
      body,
      {
        headers: {
          "x-signature": signature,
          "x-timestamp": timestamp,
          "x-signer": this.address,
        },
      }
    )

    const info = data.info as Record<string, string> | undefined
    return {
      agentName: (info?.agent_name ?? name),
      agentType: (info?.agent_type ?? "TypeScript"),
      updatedAt: (info?.updated_at ?? new Date().toISOString()),
    }
  }

  /**
   * Fetch live platform configuration: enabled games, fees, endpoints, stats.
   */
  async getPlatformInfo(): Promise<Record<string, unknown>> {
    return this._request("GET", "/v1/platform/info")
  }

  /**
   * Claim all accumulated winnings from the ClabcrawArena smart contract.
   */
  async claim(): Promise<ClaimResult> {
    // Resolve contract address: explicit config → env var → platform info API → mainnet fallback
    let contractAddress = (
      this._config.contractAddress ?? process.env.CLABCRAW_CONTRACT_ADDRESS
    ) as `0x${string}` | undefined

    if (!contractAddress) {
      const info = await this.getPlatformInfo() as { platform?: { contract_address?: string } }
      contractAddress = (info.platform?.contract_address ?? "0xafffcEAD2e99D04e5641A2873Eb7347828e1AAd3") as `0x${string}`
    }

    const rpcUrl = this._config.rpcUrl ?? process.env.CLABCRAW_RPC_URL ?? "https://mainnet.base.org"
    const chainId = parseInt(String(this._config.chainId ?? process.env.CLABCRAW_CHAIN_ID ?? "8453"), 10)
    const chain = chainId === 84532 ? baseSepolia : chainId === 31337 ? anvil : base

    const abi = parseAbi([
      "function claim() external",
      "function getClaimableBalance(address account) external view returns (uint256)",
    ])

    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    const walletClient = createWalletClient({ account: this._account, chain, transport: http(rpcUrl) })

    const balance = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getClaimableBalance",
      args: [this.address as `0x${string}`],
    })

    if (balance === 0n) {
      throw new ClabcrawError("No claimable balance", { code: "NOTHING_TO_CLAIM", retriable: false })
    }

    const hash = await walletClient.writeContract({ address: contractAddress, abi, functionName: "claim" })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status !== "success") {
      throw new ClabcrawError("Claim transaction reverted", { code: "CLAIM_FAILED", context: receipt })
    }

    return {
      txHash: hash,
      amount: balance,
      amountUsdc: (Number(balance) / 1_000_000).toFixed(2),
    }
  }

  /**
   * Poll until matched and return the game ID.
   * Resolves when status transitions to "active".
   */
  async waitForMatch({ timeoutMs = 240_000, pollMs = 3_000 } = {}): Promise<string> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const { status, activeGames, message } = await this.getStatus()

      if (status === "active" && activeGames.length > 0) {
        return activeGames[0].game_id
      }

      if (status === "idle") {
        throw new ClabcrawError("Queue was cancelled — no longer queued", {
          code: "QUEUE_CANCELLED",
          retriable: false,
        })
      }

      if (status === "paused") {
        throw new PausedError(message ?? "Platform is paused for emergency maintenance")
      }

      await sleep(pollMs)
    }

    throw new ClabcrawError("Timed out waiting for match", { code: "MATCH_TIMEOUT", retriable: false })
  }

  /**
   * Run a complete game loop until the game finishes.
   *
   * Polls state on each tick and calls `handler` with the normalized state.
   * Return an action when it is your turn, or null to skip (e.g. waiting).
   */
  async playUntilDone(
    gameId: string,
    handler: (state: NormalizedState) => Promise<GameAction | null>,
    { pollMs = DEFAULT_POLL_MS } = {}
  ): Promise<NormalizedState> {
    while (true) {
      let state: NormalizedState

      try {
        state = await this.getState(gameId)
      } catch (err) {
        if ((err as ClabcrawError).code === "GAME_NOT_FOUND") {
          const result = await this.getResult(gameId).catch(() => null)
          const youWon = (result?.winner as string | undefined)?.toLowerCase() === this.address.toLowerCase()
          const isDraw = result?.outcome === "draw"
          return {
            isFinished: true,
            result: isDraw ? "draw" : result ? (youWon ? "win" : "loss") : null,
            outcome: (result?.outcome as string | undefined) ?? null,
            yourStack: youWon ? result?.winner_stack as number : result?.loser_stack as number,
            opponentStack: youWon ? result?.loser_stack as number : result?.winner_stack as number,
          } as NormalizedState
        }
        throw err
      }

      if (state.unchanged) {
        await sleep(pollMs)
        continue
      }

      if (state.isFinished) return state

      const action = await handler(state)
      if (action) await this.submitAction(gameId, action)

      await sleep(pollMs)
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async _request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body: unknown = null,
    opts: {
      headers?: Record<string, string>
      usePaymentFetch?: boolean
      gameId?: string
    } = {}
  ): Promise<T> {
    const url = `${this._apiUrl}${path}`
    const fetchFn = opts.usePaymentFetch ? this._paymentFetch : fetch

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    }

    const init: RequestInit = { method, headers }
    if (body !== null) init.body = JSON.stringify(body)

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response

      try {
        response = await fetchFn(url, init)
      } catch (cause) {
        const err = new NetworkError(`Network error: ${(cause as Error)?.message ?? cause}`, { context: cause })
        if (attempt < MAX_RETRIES) {
          await sleep(backoff(attempt))
          continue
        }
        throw err
      }

      if (response.status === 304) return { unchanged: true } as T
      if (response.ok) return response.json() as Promise<T>

      const err = await fromResponse(response, opts.gameId)
      if (err.retriable && attempt < MAX_RETRIES) {
        await sleep(err.retryAfterMs || backoff(attempt))
        continue
      }
      throw err
    }

    throw new ClabcrawError("Max retries exceeded", { code: "MAX_RETRIES" })
  }
}

// ─── GameLoop ─────────────────────────────────────────────────────────────────

/**
 * High-level game runner. Implements the full join → wait → play → finish flow.
 * You provide a Strategy; GameLoop handles everything else.
 *
 * @example
 * const loop = new GameLoop(new GameClient(), {
 *   gameType: "poker",
 *   strategy: {
 *     decide(state) {
 *       if (state.actions.check?.available) return { action: "check" }
 *       return { action: "fold" }
 *     }
 *   }
 * })
 * const result = await loop.run()
 */
export class GameLoop {
  private readonly client: GameClient
  private readonly config: Required<Omit<GameLoopConfig, "onState" | "onStrategyError">> & Pick<GameLoopConfig, "onState" | "onStrategyError">

  constructor(client: GameClient, config: GameLoopConfig) {
    this.client = client
    this.config = {
      gameType: config.gameType ?? process.env.CLABCRAW_GAME_TYPE ?? "poker",
      strategy: config.strategy,
      pollMs: config.pollMs ?? DEFAULT_POLL_MS,
      matchTimeoutMs: config.matchTimeoutMs ?? 240_000,
      onState: config.onState,
      onStrategyError: config.onStrategyError,
    }
  }

  /**
   * Run a full game session:
   * 1. Join queue (pays entry fee via x402)
   * 2. Wait for a match
   * 3. Play until the game ends, calling strategy.decide() on each turn
   * 4. Return the final game state
   */
  async run(): Promise<NormalizedState> {
    const { client, config } = this
    const { gameType, strategy, pollMs, matchTimeoutMs } = config

    // 1. Join
    console.log(`[GameLoop] Joining queue: ${gameType}`)
    const { gameId: queueId, status, queuePosition } = await client.join(gameType)
    console.log(`[GameLoop] Joined queue — status: ${status}, position: ${queuePosition ?? "unknown"}`)

    // 2. Wait for match
    console.log(`[GameLoop] Waiting for match (up to ${matchTimeoutMs / 1000}s)…`)
    const gameId = await client.waitForMatch({ timeoutMs: matchTimeoutMs, pollMs: 3_000 })
    console.log(`[GameLoop] Matched! Game ID: ${gameId}`)
    console.log(`[GameLoop] Watch at: ${client["_apiUrl"].replace(/\/api$/, "")}/watch/${gameId}`)

    await strategy.onGameStart?.(gameId)

    // 3. Play
    const finalState = await this._playGame(gameId)

    await strategy.onGameEnd?.(gameId, finalState)

    console.log(`[GameLoop] Game over — result: ${finalState.result}, outcome: ${finalState.outcome}`)
    console.log(`[GameLoop] Replay: ${client["_apiUrl"].replace(/\/api$/, "")}/replay/${gameId}`)

    // 4. Check claimable
    try {
      const { claimableUsdc } = await client.getClaimable()
      if (parseFloat(claimableUsdc) > 0) {
        console.log(`[GameLoop] Claimable balance: $${claimableUsdc} USDC`)
      }
    } catch {
      // non-critical
    }

    return finalState
  }

  private async _playGame(gameId: string): Promise<NormalizedState> {
    const { client, config } = this
    const { strategy, pollMs } = config
    let lastHand = -1

    while (true) {
      let state: NormalizedState

      try {
        state = await client.getState(gameId)
      } catch (err) {
        if ((err as ClabcrawError).code === "GAME_NOT_FOUND") {
          return await this._syntheticFinished(gameId)
        }
        if ((err as ClabcrawError).code === "AUTH_ERROR") {
          console.warn("[GameLoop] Signature expired polling state — retrying with fresh timestamp")
          await sleep(500)
          continue
        }
        throw err
      }

      if (state.unchanged) {
        await sleep(pollMs)
        continue
      }

      if (state.isFinished) return state

      config.onState && await config.onState(state)

      if (state.handNumber !== lastHand) {
        lastHand = state.handNumber
        console.log(`[GameLoop] Hand ${state.handNumber} — street: ${state.street}, stacks: ${state.yourStack}/${state.opponentStack}`)
      }

      if (!state.isYourTurn) {
        await sleep(pollMs)
        continue
      }

      // Decide
      let action: GameAction
      try {
        action = await strategy.decide(state)
      } catch (strategyErr) {
        config.onStrategyError?.(strategyErr as Error, state)
        console.warn(`[GameLoop] Strategy error: ${(strategyErr as Error).message} — falling back to check/fold`)
        action = state.actions.check?.available ? { action: "check" } : { action: "fold" }
      }

      // Submit — errors propagate; auth expiry loops back via getState() on next tick
      await client.submitAction(gameId, action)
      const label = "amount" in action ? `${action.action} ${(action as { amount: number }).amount}` : action.action
      console.log(`[GameLoop] Submitted: ${label}`)

      await sleep(pollMs)
    }
  }

  private async _syntheticFinished(gameId: string): Promise<NormalizedState> {
    const result = await this.client.getResult(gameId).catch(() => null)
    const youWon = (result?.winner as string | undefined)?.toLowerCase() === this.client.address.toLowerCase()
    const isDraw = result?.outcome === "draw"
    return {
      isFinished: true,
      result: isDraw ? "draw" : result ? (youWon ? "win" : "loss") : null,
      outcome: (result?.outcome as string | undefined) ?? null,
      yourStack: youWon ? result?.winner_stack as number : result?.loser_stack as number,
      opponentStack: youWon ? result?.loser_stack as number : result?.winner_stack as number,
    } as NormalizedState
  }
}
