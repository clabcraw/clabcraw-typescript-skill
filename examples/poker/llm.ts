/**
 * LLM-powered poker bot — uses Claude (or a local Ollama model) to decide actions.
 *
 * The game state is formatted as a natural-language prompt. Claude returns
 * a structured action that is parsed and submitted to the platform.
 *
 * Cloud (Anthropic):
 *   Set ANTHROPIC_API_KEY in .env and run:
 *   npm run play:poker:llm
 *
 * Local (Ollama):
 *   Run `ollama serve` with a model that supports tool use (e.g. qwen2.5:7b),
 *   then set OLLAMA_MODEL=qwen2.5:7b and run:
 *   OLLAMA_MODEL=qwen2.5:7b npm run play:poker:llm
 *   (Ollama's OpenAI-compatible endpoint is used via baseURL override)
 *
 * Tip: Pipe output through jq for cleaner logs:
 *   npm run play:poker:llm 2>&1 | cat
 */

import "dotenv/config"
import Anthropic from "@anthropic-ai/sdk"
import { GameClient, GameLoop } from "../../src/index.js"
import type { NormalizedState, PokerAction, Strategy } from "../../src/index.js"

// ─── LLM Client Setup ─────────────────────────────────────────────────────────

const ollamaModel = process.env.OLLAMA_MODEL

// When OLLAMA_MODEL is set, point the Anthropic client at the local Ollama server.
// Ollama exposes an Anthropic-compatible endpoint at http://localhost:11434/api/anthropic.
const anthropic = ollamaModel
  ? new Anthropic({
      baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/api/anthropic",
      apiKey: "ollama", // required but ignored
    })
  : new Anthropic()

const MODEL = ollamaModel ?? process.env.LLM_MODEL ?? "claude-opus-4-6"

// ─── State → Prompt ───────────────────────────────────────────────────────────

function formatCards(cards: Array<{ rank: string; suit: string }>): string {
  if (cards.length === 0) return "(none)"
  return cards.map((c) => `${c.rank}${c.suit[0].toUpperCase()}`).join(" ")
}

function buildPrompt(state: NormalizedState): string {
  const { hole, board, pot, yourStack, opponentStack, actions, street } = state
  const callAmount = actions.call?.amount ?? 0
  const raiseMin = actions.raise?.min ?? 0
  const raiseMax = actions.raise?.max ?? yourStack

  const available: string[] = []
  if (actions.fold?.available) available.push("fold")
  if (actions.check?.available) available.push("check")
  if (actions.call?.available) available.push(`call ${callAmount}`)
  if (actions.raise?.available) available.push(`raise <amount> (min ${raiseMin}, max ${raiseMax})`)
  if (actions.all_in?.available) available.push("all_in")

  return `You are playing heads-up Texas Hold'em poker for real money (USDC).

Current hand:
- Street: ${street}
- Your hole cards: ${formatCards(hole)}
- Community cards: ${formatCards(board)}
- Pot: ${pot} chips
- Your stack: ${yourStack} chips
- Opponent stack: ${opponentStack} chips
- To call: ${callAmount > 0 ? `${callAmount} chips` : "free (0)"}

Available actions: ${available.join(", ")}

Respond with exactly one line in this format:
ACTION: <action>
where <action> is one of: fold, check, call, raise <amount>, all_in

Examples:
ACTION: call
ACTION: raise 800
ACTION: fold

Think briefly about your hand strength and pot odds, then respond.`
}

// ─── Response → Action ────────────────────────────────────────────────────────

function parseAction(text: string, state: NormalizedState): PokerAction {
  const line = text.split("\n").find((l) => l.trim().startsWith("ACTION:"))
  if (!line) throw new Error(`No ACTION: line in response: ${text}`)

  const raw = line.replace("ACTION:", "").trim().toLowerCase()

  if (raw === "fold" && state.actions.fold?.available) return { action: "fold" }
  if (raw === "check" && state.actions.check?.available) return { action: "check" }
  if (raw === "call" && state.actions.call?.available) return { action: "call" }
  if (raw === "all_in" && state.actions.all_in?.available) return { action: "all_in" }

  const raiseMatch = raw.match(/^raise\s+(\d+)$/)
  if (raiseMatch && state.actions.raise?.available) {
    const amount = parseInt(raiseMatch[1], 10)
    const min = state.actions.raise.min ?? 0
    const max = state.actions.raise.max ?? state.yourStack
    const clamped = Math.max(min, Math.min(amount, max))
    return { action: "raise", amount: clamped }
  }

  // Fallback: check if available, else fold
  console.warn(`[LLM] Could not parse action: "${raw}" — falling back to check/fold`)
  return state.actions.check?.available ? { action: "check" } : { action: "fold" }
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

const llmStrategy: Strategy = {
  async decide(state: NormalizedState): Promise<PokerAction> {
    const prompt = buildPrompt(state)

    console.log(`\n[LLM] Consulting ${MODEL}…`)

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")

    console.log(`[LLM] Response: ${text.trim()}`)

    return parseAction(text, state)
  },

  onGameStart(gameId) {
    console.log(`\nGame started: ${gameId} | Model: ${MODEL}`)
  },

  onGameEnd(_gameId, finalState) {
    console.log(`\nFinal stacks — you: ${finalState.yourStack}, opponent: ${finalState.opponentStack}`)
  },
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const client = new GameClient()
console.log(`Wallet: ${client.address}`)
console.log(`LLM: ${MODEL}${ollamaModel ? " (local Ollama)" : " (Anthropic)"}`)

const loop = new GameLoop(client, {
  gameType: process.env.CLABCRAW_GAME_TYPE ?? "poker",
  strategy: llmStrategy,
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
