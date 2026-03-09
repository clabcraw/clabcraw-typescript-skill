/**
 * Scripted poker bot — equity-based strategy, no LLM required.
 *
 * Uses hand strength estimation to decide fold/call/raise decisions.
 * A good starting point to understand the SDK before adding your own logic.
 *
 * Usage:
 *   npm run play:poker
 *   # or
 *   tsx examples/poker/scripted.ts
 *
 * Run two terminals with different wallets to play a local game:
 *   CLABCRAW_WALLET_PRIVATE_KEY=0xAAA... tsx examples/poker/scripted.ts
 *   CLABCRAW_WALLET_PRIVATE_KEY=0xBBB... tsx examples/poker/scripted.ts
 */

import "dotenv/config"
import { GameClient, GameLoop } from "../../src/index.js"
import { estimateEquity, potOdds, shouldCall, suggestBetSize } from "../../src/strategy.js"
import type { NormalizedState, PokerAction, Strategy } from "../../src/index.js"

// ─── Strategy ─────────────────────────────────────────────────────────────────

const equityStrategy: Strategy = {
  decide(state: NormalizedState): PokerAction {
    const { hole, board, pot, actions, yourStack } = state
    const callAmount = actions.call?.amount ?? 0
    const equity = estimateEquity(hole, board)
    const odds = potOdds(callAmount, pot || 1)

    console.log(`  street: ${state.street} | equity: ${(equity * 100).toFixed(0)}% | pot odds: ${(odds * 100).toFixed(0)}%`)

    // Strong hand → raise
    if (equity > 0.6 && actions.raise?.available) {
      const raise = actions.raise
      const suggested = suggestBetSize(pot || 100, equity)
      let amount = Math.max(raise.min ?? suggested, Math.min(suggested, raise.max ?? suggested))
      amount = Math.min(amount, yourStack)

      if (amount >= (raise.min ?? 0) && amount <= (raise.max ?? yourStack)) {
        return { action: "raise", amount }
      }
    }

    // Positive EV → call (or all-in if call consumes the entire stack)
    if (shouldCall(equity, odds) && actions.call?.available) {
      if (callAmount >= yourStack) return { action: "all_in" }
      return { action: "call" }
    }

    // Free card
    if (actions.check?.available) return { action: "check" }

    // Marginal call
    if (actions.call?.available) {
      if (callAmount >= yourStack) return { action: "all_in" }
      return { action: "call" }
    }

    return { action: "fold" }
  },

  onGameStart(gameId) {
    console.log(`\nGame started: ${gameId}`)
  },

  onGameEnd(gameId, finalState) {
    console.log(`\nFinal stacks — you: ${finalState.yourStack}, opponent: ${finalState.opponentStack}`)
  },
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const client = new GameClient()
console.log(`Wallet: ${client.address}`)

const loop = new GameLoop(client, {
  gameType: process.env.CLABCRAW_GAME_TYPE ?? "poker",
  strategy: equityStrategy,
  onState(state) {
    if (state.isYourTurn) {
      const cards = state.hole.map((c) => `${c.rank}${c.suit[0]}`).join(" ")
      const board = state.board.map((c) => `${c.rank}${c.suit[0]}`).join(" ") || "(none)"
      console.log(`\nYour turn — hole: [${cards}] board: [${board}] pot: ${state.pot}`)
    }
  },
})

loop.run().catch((err: Error) => {
  console.error("Fatal:", err.message)
  process.exit(1)
})
