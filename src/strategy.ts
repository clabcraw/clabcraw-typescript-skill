/**
 * Poker strategy helpers.
 *
 * Provides hand evaluation, equity estimation, pot odds, and bet sizing
 * utilities. Import what you need in your strategy:
 *
 *   import { estimateEquity, potOdds, shouldCall } from "../src/strategy.js"
 */

import type { Card } from "./types.js"

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]

function parseCard(card: string | Card): Card {
  if (typeof card === "object" && card !== null && card.rank) return card
  if (typeof card !== "string" || card.length < 2) return { rank: "?", suit: "?" }
  const rank = card.startsWith("10") ? "10" : card[0]
  const suit = card.slice(rank.length)
  return { rank, suit }
}

function rankIndex(rank: string): number {
  return RANKS.indexOf(rank)
}

// ─── Hand Ranking ─────────────────────────────────────────────────────────────

/**
 * Evaluate the best 5-card hand rank from up to 7 cards.
 * Returns 0 (high card) through 8 (straight flush).
 */
export function handRank(cards: Array<string | Card>): number {
  if (!cards || cards.length < 2) return 0

  const parsed = cards.map(parseCard)
  const ranks = parsed.map((c) => rankIndex(c.rank))
  const suits = parsed.map((c) => c.suit)

  const rankCounts: Record<number, number> = {}
  for (const r of ranks) rankCounts[r] = (rankCounts[r] ?? 0) + 1

  const counts = Object.values(rankCounts).sort((a, b) => b - a)
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b)

  const suitCounts: Record<string, number> = {}
  for (const s of suits) suitCounts[s] = (suitCounts[s] ?? 0) + 1
  const hasFlush = Object.values(suitCounts).some((c) => c >= 5)
  const hasStraight = _hasStraight(uniqueRanks)

  if (hasFlush && hasStraight) return 8
  if (counts[0] === 4) return 7
  if (counts[0] === 3 && counts[1] === 2) return 6
  if (hasFlush) return 5
  if (hasStraight) return 4
  if (counts[0] === 3) return 3
  if (counts[0] === 2 && counts[1] === 2) return 2
  if (counts[0] === 2) return 1
  return 0
}

/**
 * Human-readable hand description.
 */
export function describeHand(cards: Array<string | Card>): string {
  const NAMES = [
    "High card", "Pair", "Two pair", "Three of a kind",
    "Straight", "Flush", "Full house", "Four of a kind", "Straight flush",
  ]
  return NAMES[handRank(cards)] ?? "Unknown"
}

/**
 * Count approximate outs to improve the hand on the next street.
 */
export function countOuts(hole: Array<string | Card>, board: Array<string | Card>): number {
  const allCards = [...hole, ...board].map(parseCard)
  const current = handRank(allCards)
  let outs = 0

  const suits = allCards.map((c) => c.suit)
  const suitCounts: Record<string, number> = {}
  for (const s of suits) suitCounts[s] = (suitCounts[s] ?? 0) + 1
  if (Object.values(suitCounts).some((c) => c === 4)) outs += 9

  const ranks = [...new Set(allCards.map((c) => rankIndex(c.rank)))].sort((a, b) => a - b)
  if (_hasOpenEndedDraw(ranks)) outs += 8
  if (_hasGutshotDraw(ranks)) outs += 4

  if (current === 1) outs += 2  // pair → trips
  if (current === 2) outs += 4  // two pair → full house

  return Math.min(outs, 21)
}

// ─── Equity Estimation ────────────────────────────────────────────────────────

/**
 * Estimate hand equity at any street (0.0–1.0).
 *
 * Preflop: heuristic based on hole card strength.
 * Flop/Turn/River: evaluates made hand rank + draw outs.
 */
export function estimateEquity(
  holeCards: Array<string | Card>,
  communityCards: Array<string | Card> = []
): number {
  if (!holeCards || holeCards.length !== 2) return 0.5

  const hole = holeCards.map(parseCard)
  const board = communityCards.map(parseCard)

  return board.length === 0 ? _preflopEquity(hole) : _postflopEquity(hole, board)
}

// ─── Pot Odds & Bet Sizing ────────────────────────────────────────────────────

/**
 * Calculate pot odds as a fraction (0.0–1.0).
 * This is the fraction of the total pot you must risk to continue.
 */
export function potOdds(callAmount: number, currentPot: number): number {
  if (callAmount <= 0) return 0
  return callAmount / (currentPot + callAmount)
}

/**
 * Check if calling is profitable given equity and pot odds.
 * @param margin Safety margin (default 0.1 = require 10% edge)
 */
export function shouldCall(equity: number, odds: number, margin = 0.1): boolean {
  return equity > odds + margin
}

/**
 * Suggest a bet size as a fraction of the pot, scaled by equity.
 */
export function suggestBetSize(pot: number, equity: number): number {
  if (equity > 0.75) return Math.floor(pot * 0.75)
  if (equity > 0.60) return Math.floor(pot * 0.60)
  if (equity > 0.50) return Math.floor(pot * 0.40)
  return Math.floor(pot * 0.25)
}

// ─── Internals ────────────────────────────────────────────────────────────────

function _preflopEquity(hole: Card[]): number {
  const c1 = hole[0]
  const c2 = hole[1]
  const r1 = rankIndex(c1.rank)
  const r2 = rankIndex(c2.rank)

  if (c1.rank === c2.rank) return 0.6 + (r1 / 13) * 0.2  // pocket pair: 60–80%

  const isAce = r1 === 12 || r2 === 12
  const isBroadway = r1 >= 9 && r2 >= 9

  if (isAce && isBroadway) return 0.55  // AK, AQ, AJ
  if (isBroadway) return 0.50           // KQ, KJ, QJ
  if (r1 >= 9 || r2 >= 9) return 0.40  // one broadway card

  const suited = c1.suit === c2.suit
  const connected = Math.abs(r1 - r2) === 1
  if (suited && connected) return 0.40  // suited connectors

  return 0.35
}

function _postflopEquity(hole: Card[], board: Card[]): number {
  const allCards = [...hole, ...board]
  const rank = handRank(allCards)
  const BASE = [0.35, 0.50, 0.60, 0.68, 0.74, 0.78, 0.84, 0.91, 0.95]
  let equity = BASE[rank] ?? 0.35

  const cardsToGo = 5 - board.length
  if (cardsToGo > 0 && rank < 5) {
    const outs = countOuts(hole, board)
    const drawEquity = outs * (cardsToGo === 1 ? 0.02 : 0.04)
    equity = Math.min(0.95, equity + drawEquity * (1 - equity))
  }

  return equity
}

function _hasStraight(sortedUniqueRanks: number[]): boolean {
  const withLowAce = sortedUniqueRanks.includes(12)
    ? [...sortedUniqueRanks, -1].sort((a, b) => a - b)
    : sortedUniqueRanks

  for (let i = 0; i <= withLowAce.length - 5; i++) {
    const slice = withLowAce.slice(i, i + 5)
    if (slice[4] - slice[0] === 4 && new Set(slice).size === 5) return true
  }
  return false
}

function _hasOpenEndedDraw(sortedRanks: number[]): boolean {
  for (let i = 0; i <= sortedRanks.length - 4; i++) {
    const slice = sortedRanks.slice(i, i + 4)
    if (slice[3] - slice[0] === 3 && new Set(slice).size === 4) return true
  }
  return false
}

function _hasGutshotDraw(sortedRanks: number[]): boolean {
  for (let i = 0; i <= sortedRanks.length - 4; i++) {
    const slice = sortedRanks.slice(i, i + 4)
    if (slice[3] - slice[0] === 4 && new Set(slice).size === 4) return true
  }
  return false
}
