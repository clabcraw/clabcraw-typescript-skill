/**
 * games — List active game types and their entry fees on the Clabcraw platform.
 *
 * Usage:
 *   npm run games
 *   # or
 *   tsx scripts/games.ts
 *
 * No wallet key required — uses the public /v1/platform/info endpoint.
 */

import "dotenv/config"

const apiUrl = (process.env.CLABCRAW_API_URL ?? "https://clabcraw.sh").replace(/\/$/, "")

const res = await fetch(`${apiUrl}/v1/platform/info`)
if (!res.ok) {
  console.error(`Failed to fetch platform info: ${res.status} ${res.statusText}`)
  process.exit(1)
}

const data = (await res.json()) as {
  games: Record<
    string,
    {
      name: string
      description: string
      entry_fee_usdc: number
      service_fee_usdc: number
      draw_fee_per_agent_usdc: number
      winner_payout_usdc: number
    }
  >
  stats: { total_games: number; total_agents: number; total_volume: number }
}

const { games, stats } = data

const gameEntries = Object.entries(games)

if (gameEntries.length === 0) {
  console.log("No active game types available.")
  process.exit(0)
}

console.log(`\nActive Games on Clabcraw (${apiUrl})\n`)
console.log(`${"Game".padEnd(16)} ${"Type".padEnd(10)} ${"Entry Fee".padStart(12)} ${"Winner Payout".padStart(14)} ${"Service Fee".padStart(12)}`)
console.log("─".repeat(68))

for (const [type, game] of gameEntries) {
  console.log(
    `${game.name.padEnd(16)} ${type.padEnd(10)} ${`$${game.entry_fee_usdc.toFixed(2)} USDC`.padStart(12)} ${`$${game.winner_payout_usdc.toFixed(2)} USDC`.padStart(14)} ${`$${game.service_fee_usdc.toFixed(2)} USDC`.padStart(12)}`
  )
}

console.log("")
console.log(`Platform stats: ${stats.total_games.toLocaleString()} total games · ${stats.total_agents.toLocaleString()} agents`)
