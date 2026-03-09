/**
 * LLM-powered chess bot — uses Claude (or a local Ollama model) to pick moves.
 *
 * The board is rendered as ASCII and legal moves are listed. The LLM picks
 * one move from the list. Invalid responses fall back to a random legal move.
 *
 * Cloud (Anthropic):
 *   Set ANTHROPIC_API_KEY in .env and run:
 *   npm run play:chess:llm
 *
 * Local (Ollama):
 *   OLLAMA_MODEL=qwen2.5:7b npm run play:chess:llm
 */

import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"
import { GameClient, GameLoop } from "../../src/index.js"
import type { NormalizedState, ChessAction, Strategy } from "../../src/index.js"

// ─── LLM Client Setup ─────────────────────────────────────────────────────────

const ollamaModel = process.env.OLLAMA_MODEL

const anthropic = ollamaModel
  ? new Anthropic({
      baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/api/anthropic",
      apiKey: "ollama",
    })
  : new Anthropic()

const MODEL = ollamaModel ?? process.env.LLM_MODEL ?? "claude-opus-4-6"

// ─── Board Rendering ──────────────────────────────────────────────────────────

type RawBoard = Record<string, { color: "w" | "b"; type: string }>

const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
  w: { p: "♙", r: "♖", n: "♘", b: "♗", q: "♕", k: "♔" },
  b: { p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚" },
}

function renderBoard(board: RawBoard, yourColor: "w" | "b"): string {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"]
  const ranks = yourColor === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]
  const orderedFiles = yourColor === "w" ? files : [...files].reverse()

  const rows = ranks.map((rank) => {
    const cells = orderedFiles.map((file) => {
      const sq = `${file}${rank}`
      const piece = board[sq]
      if (!piece) return "·"
      return PIECE_SYMBOLS[piece.color]?.[piece.type] ?? "?"
    })
    return `${rank} ${cells.join(" ")}`
  })

  const fileRow = `  ${orderedFiles.join(" ")}`
  return [fileRow, ...rows].join("\n")
}

// ─── State → Prompt ───────────────────────────────────────────────────────────

function buildPrompt(state: NormalizedState): string {
  const board = state.raw.board as RawBoard | undefined
  const yourColor = (state.raw.your_color as "w" | "b" | undefined) ?? "w"
  const legalMoves = state.actions.move?.examples ?? []

  const boardStr = board ? renderBoard(board, yourColor) : "(board not available)"
  const colorName = yourColor === "w" ? "White" : "Black"

  // Group moves by from-square for readability
  const grouped: Record<string, string[]> = {}
  for (const move of legalMoves) {
    const from = move.slice(0, 2)
    grouped[from] = grouped[from] ?? []
    grouped[from].push(move)
  }
  const moveList = Object.entries(grouped)
    .map(([from, moves]) => `  ${from}: ${moves.join(", ")}`)
    .join("\n")

  return `You are playing chess as ${colorName}.

Current board (your pieces shown from your perspective):
${boardStr}

Legal moves (UCI notation, grouped by piece):
${moveList}

Choose one move from the list above.
Respond with exactly one line:
MOVE: <uci>

Example: MOVE: e2e4

Consider piece development, captures, checks, and tactical threats.`
}

// ─── Response → Action ────────────────────────────────────────────────────────

function parseMove(text: string, state: NormalizedState): ChessAction {
  const line = text.split("\n").find((l) => l.trim().startsWith("MOVE:"))
  if (!line) throw new Error(`No MOVE: line in response: ${text}`)

  const move = line.replace("MOVE:", "").trim().toLowerCase()
  const legalMoves = state.actions.move?.examples ?? []

  if (legalMoves.includes(move)) {
    return { action: "move", move }
  }

  // Fallback: pick a random legal move
  console.warn(`[LLM] Suggested move "${move}" is not in legal moves — picking random`)
  const random = legalMoves[Math.floor(Math.random() * legalMoves.length)]
  if (random) return { action: "move", move: random }

  return { action: "resign" }
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

const llmStrategy: Strategy = {
  async decide(state: NormalizedState): Promise<ChessAction> {
    const moveAction = state.actions.move
    if (!moveAction?.available || (moveAction.examples?.length ?? 0) === 0) {
      return { action: "resign" }
    }

    const prompt = buildPrompt(state)
    console.log(`\n[LLM] Consulting ${MODEL} (${moveAction.examples?.length} legal moves)…`)

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")

    console.log(`[LLM] Response: ${text.trim()}`)

    return parseMove(text, state)
  },

  onGameStart(gameId) {
    console.log(`\nGame started: ${gameId} | Model: ${MODEL}`)
  },

  onGameEnd(_gameId, finalState) {
    console.log(`\nResult: ${finalState.result} — ${finalState.outcome ?? ""}`)
  },
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const client = new GameClient()
console.log(`Wallet: ${client.address}`)
console.log(`LLM: ${MODEL}${ollamaModel ? " (local Ollama)" : " (Anthropic)"}`)

const loop = new GameLoop(client, {
  gameType: process.env.CLABCRAW_GAME_TYPE ?? "chess",
  strategy: llmStrategy,
  pollMs: 500,
  onState(state) {
    if (state.isYourTurn) {
      const color = (state.raw.your_color as string) === "w" ? "White" : "Black"
      console.log(`\nYour turn (${color})`)
    }
  },
})

loop.run().catch((err: Error) => {
  console.error("Fatal:", err.message)
  process.exit(1)
})
