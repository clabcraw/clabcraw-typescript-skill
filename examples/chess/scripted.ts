/**
 * Scripted chess bot — greedy capture strategy, no LLM required.
 *
 * Strategy:
 *   1. If any legal move captures an opponent piece, pick one at random.
 *   2. Otherwise, pick a random legal move.
 *
 * This dramatically speeds up games vs. pure random play as pieces trade off quickly.
 *
 * Usage:
 *   npm run play:chess
 *   # or
 *   CLABCRAW_GAME_TYPE=chess tsx examples/chess/scripted.ts
 */

import "dotenv/config"
import { GameClient, GameLoop } from "../../src/index.js"
import type { NormalizedState, ChessAction, Strategy } from "../../src/index.js"

// ─── Strategy ─────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const captureStrategy: Strategy = {
  decide(state: NormalizedState): ChessAction {
    const moveAction = state.actions.move
    if (!moveAction?.available) return { action: "resign" }

    const moves = moveAction.examples ?? []
    if (moves.length === 0) return { action: "resign" }

    const board = state.raw.board as Record<string, { color: string; type: string }> | undefined
    const myColor = state.raw.your_color as string | undefined

    // A move is a capture if the destination square has an opponent piece.
    // UCI format: "e2e4" → from=e2, to=e4. Promotions like "e7e8q" are handled.
    const captures = board && myColor
      ? moves.filter((uci) => {
          const to = uci.slice(2, 4)
          const piece = board[to]
          return piece && piece.color !== myColor
        })
      : []

    const chosen = captures.length > 0 ? pickRandom(captures) : pickRandom(moves)

    if (captures.length > 0) {
      console.log(`  capture: ${chosen} (${captures.length} captures available)`)
    } else {
      console.log(`  random move: ${chosen} (${moves.length} legal moves)`)
    }

    return { action: "move", move: chosen }
  },

  onGameStart(gameId) {
    console.log(`\nGame started: ${gameId}`)
  },

  onGameEnd(_gameId, finalState) {
    console.log(`\nResult: ${finalState.result} — ${finalState.outcome ?? ""}`)
  },
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const client = new GameClient()
console.log(`Wallet: ${client.address}`)

const loop = new GameLoop(client, {
  gameType: process.env.CLABCRAW_GAME_TYPE ?? "chess",
  strategy: captureStrategy,
  pollMs: 500,
  onState(state) {
    if (state.isYourTurn) {
      const color = (state.raw.your_color as string) === "w" ? "White" : "Black"
      const moveCount = state.actions.move?.examples?.length ?? 0
      console.log(`\nYour turn (${color}) — ${moveCount} legal moves`)
    }
  },
})

loop.run().catch((err: Error) => {
  console.error("Fatal:", err.message)
  process.exit(1)
})
