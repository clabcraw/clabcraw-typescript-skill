// ─── Cards ────────────────────────────────────────────────────────────────────

export interface Card {
  rank: string // "2"-"9", "T", "J", "Q", "K", "A"
  suit: string // "spades", "hearts", "diamonds", "clubs"
}

export type ChessPieceType = "p" | "r" | "n" | "b" | "q" | "k"
export type ChessColor = "w" | "b"

export interface ChessPiece {
  color: ChessColor
  type: ChessPieceType
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export interface FoldAction { action: "fold" }
export interface CheckAction { action: "check" }
export interface CallAction { action: "call" }
export interface RaiseAction { action: "raise"; amount: number }
export interface AllInAction { action: "all_in" }
export interface MoveAction { action: "move"; move: string }
export interface ResignAction { action: "resign" }

export type PokerAction = FoldAction | CheckAction | CallAction | RaiseAction | AllInAction
export type ChessAction = MoveAction | ResignAction
export type GameAction = PokerAction | ChessAction

// ─── Action Map ───────────────────────────────────────────────────────────────

export interface ActionInfo {
  available: boolean
  amount?: number   // for call: how much to call
  min?: number      // for raise: minimum raise amount
  max?: number      // for raise: maximum raise amount (= all-in amount)
  examples?: string[] // for move: list of all legal UCI moves
}

export type ActionMap = Record<string, ActionInfo>

// ─── Normalized Game State ────────────────────────────────────────────────────

export interface NormalizedState {
  gameId: string | null
  handNumber: number
  isYourTurn: boolean
  isFinished: boolean
  unchanged: boolean
  street: string // "preflop" | "flop" | "turn" | "river" | "showdown" | "complete"
  hole: Card[]   // your 2 hole cards (poker only)
  board: Card[]  // community cards 0–5 (poker only)
  pot: number
  yourStack: number
  opponentStack: number
  moveDeadlineMs: number | null // ms until move deadline; negative = past
  actions: ActionMap
  potOdds: number         // callAmount / (pot + callAmount); 0 when free to check
  effectiveStack: number  // min(yourStack, opponentStack) — max chips at risk
  result: "win" | "loss" | "draw" | "force_draw" | null
  outcome: string | null
  opponentCards: Card[] | null
  winningHand: string | null
  raw: Record<string, unknown>
}

// ─── Strategy Interface ───────────────────────────────────────────────────────

/**
 * Implement this interface to create your own game strategy.
 * `decide()` is called each time it is your turn.
 *
 * @example
 * const myStrategy: Strategy = {
 *   decide(state) {
 *     if (state.actions.check?.available) return { action: "check" }
 *     return { action: "fold" }
 *   }
 * }
 */
export interface Strategy {
  /**
   * Return the action to take given the current state.
   * Called only when `state.isYourTurn === true`.
   * May return a Promise to support async decisions (LLM calls, DB lookups, etc.).
   */
  decide(state: NormalizedState): GameAction | Promise<GameAction>

  /** Optional hook called once when the game starts. */
  onGameStart?(gameId: string): void | Promise<void>

  /** Optional hook called once when the game ends with the final state. */
  onGameEnd?(gameId: string, finalState: NormalizedState): void | Promise<void>
}

// ─── Config ───────────────────────────────────────────────────────────────────

export type GameType = "poker" | "chess" | string

export interface ClientConfig {
  /** Wallet private key (0x-prefixed). Falls back to CLABCRAW_WALLET_PRIVATE_KEY env var. */
  privateKey?: string
  /** API base URL. Falls back to CLABCRAW_API_URL env var, then "https://clabcraw.sh". */
  apiUrl?: string
  /** RPC URL for on-chain calls (claim). Falls back to CLABCRAW_RPC_URL env var. */
  rpcUrl?: string
  /** Smart contract address. Falls back to CLABCRAW_CONTRACT_ADDRESS env var. */
  contractAddress?: string
  /** Chain ID (8453 = Base mainnet, 84532 = Base Sepolia). */
  chainId?: number | string
}

export interface GameLoopConfig {
  /** Game type to join: "poker" or "chess". Default: CLABCRAW_GAME_TYPE env var or "poker". */
  gameType?: GameType
  /** Strategy instance that decides each action. */
  strategy: Strategy
  /** State poll interval when unchanged (ms). Default: 1000 */
  pollMs?: number
  /** Max time to wait for a match (ms). Default: 240_000 */
  matchTimeoutMs?: number
  /** Called with every new state (useful for logging/inspection). */
  onState?: (state: NormalizedState) => void | Promise<void>
  /** Called when strategy.decide() throws. Default: falls back to check/fold. */
  onStrategyError?: (err: Error, state: NormalizedState) => void
}

// ─── API Result Types ─────────────────────────────────────────────────────────

export interface JoinResult {
  gameId: string | null
  status: string
  queuePosition: number | null
}

export interface AgentStatus {
  status: string
  activeGames: Array<{ game_id: string; [key: string]: unknown }>
  queuePosition: number | null
  pauseMode: string | null
  message: string | null
}

export interface ClaimResult {
  txHash: `0x${string}`
  amount: bigint
  amountUsdc: string
}

export interface ClaimableResult {
  claimableBalance: number
  claimableUsdc: string
}
