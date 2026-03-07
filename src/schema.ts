/**
 * Game state normalization.
 *
 * Converts the raw API response into a cleaner structure:
 *
 *   state.isYourTurn          // boolean
 *   state.isFinished          // boolean
 *   state.street              // "preflop" | "flop" | "turn" | "river" | "showdown"
 *   state.hole                // [{ rank, suit }, { rank, suit }]
 *   state.board               // [{ rank, suit }, ...]  (0–5 cards)
 *   state.pot                 // number (chips)
 *   state.yourStack           // number (chips)
 *   state.opponentStack       // number (chips)
 *   state.moveDeadlineMs      // ms until move deadline (negative = past)
 *   state.actions             // normalized action map
 *   state.potOdds             // callAmount / (pot + callAmount); 0 when free
 *   state.effectiveStack      // min(yourStack, opponentStack)
 *   state.result              // "win" | "loss" | "draw" | null
 *   state.raw                 // original API response
 */

import type { Card, ActionMap, NormalizedState } from "./types.js"

/**
 * Parse a card string like "Aspades" → { rank: "A", suit: "spades" }.
 * Already-parsed objects are returned as-is.
 */
export function parseCard(card: string | Card): Card {
  if (typeof card === "object" && card !== null && card.rank) return card
  if (typeof card !== "string" || card.length < 2) return { rank: "?", suit: "?" }
  const rank = card.startsWith("10") ? "10" : card[0]
  const suit = card.slice(rank.length)
  return { rank, suit }
}

/**
 * Normalize the valid_actions object from the API into a flat map where
 * each key is an action name and the value contains availability + amounts.
 *
 * Raw:   { fold: {}, call: { amount: 100 }, raise: { min: 200, max: 800 } }
 * Normal: {
 *   fold:   { available: true },
 *   check:  { available: false },
 *   call:   { available: true, amount: 100 },
 *   raise:  { available: true, min: 200, max: 800 },
 *   all_in: { available: false, amount: 0 },
 * }
 */
function normalizeActions(validActions: Record<string, unknown> | undefined): ActionMap {
  const baseNames = ["fold", "check", "call", "raise", "all_in", "move", "resign"]
  const dynamic = Object.keys(validActions ?? {})
  const all = [...new Set([...baseNames, ...dynamic])]
  const result: ActionMap = {}

  for (const name of all) {
    if (validActions && name in validActions) {
      result[name] = { available: true, ...(validActions[name] as object) }
    } else {
      result[name] = { available: false }
    }
  }

  return result
}

/**
 * Normalize a raw game state response from the Clabcraw API.
 */
export function normalizeState(raw: Record<string, unknown>): NormalizedState {
  if (!raw || typeof raw !== "object") {
    return { unchanged: true, raw } as unknown as NormalizedState
  }

  if (raw.unchanged) {
    return { unchanged: true, raw } as unknown as NormalizedState
  }

  const hole = ((raw.your_cards as string[] | undefined) ?? []).map(parseCard)
  const board = ((raw.community_cards as string[] | undefined) ?? []).map(parseCard)
  const moveDeadlineMs = raw.move_deadline
    ? new Date(raw.move_deadline as string).getTime() - Date.now()
    : null

  const validActions = raw.valid_actions as Record<string, unknown> | undefined
  const callAmount = (validActions?.call as { amount?: number } | undefined)?.amount ?? 0
  const pot = (raw.pot as number | undefined) ?? 0

  return {
    gameId: (raw.game_id as string | undefined) ?? null,
    handNumber: (raw.hand_number as number | undefined) ?? 1,
    isYourTurn: raw.is_your_turn === true,
    isFinished: raw.game_status === "finished" || raw.game_status === "complete",
    unchanged: false,
    street: (raw.current_street as string | undefined) ?? "preflop",
    hole,
    board,
    pot,
    yourStack: (raw.your_stack as number | undefined) ?? 0,
    opponentStack: (raw.opponent_stack as number | undefined) ?? 0,
    moveDeadlineMs,
    actions: normalizeActions(validActions),
    get potOdds() {
      return callAmount > 0 ? callAmount / (pot + callAmount) : 0
    },
    effectiveStack: Math.min(
      (raw.your_stack as number | undefined) ?? 0,
      (raw.opponent_stack as number | undefined) ?? 0
    ),
    result: (raw.result as NormalizedState["result"]) ?? null,
    outcome: (raw.outcome as string | undefined) ?? null,
    opponentCards: raw.opponent_cards
      ? (raw.opponent_cards as string[]).map(parseCard)
      : null,
    winningHand: (raw.winning_hand as string | undefined) ?? null,
    raw,
  }
}
