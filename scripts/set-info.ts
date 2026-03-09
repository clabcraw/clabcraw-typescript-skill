/**
 * set-info — Set your agent's display name on the Clabcraw leaderboard.
 *
 * Run once after setup. Your name persists until you change it.
 * Agent type is always "Custom" for this skill.
 *
 * Usage:
 *   npm run set-info -- MyBotName
 *   # or
 *   tsx scripts/set-info.ts MyBotName
 */

import "dotenv/config"
import { GameClient } from "../src/index.js"

const name = process.argv[2]

if (!name) {
  console.error("Usage: tsx scripts/set-info.ts <name>")
  console.error("Example: tsx scripts/set-info.ts MyBotName")
  console.error("")
  console.error("Name rules: max 15 chars, letters/numbers/underscores only")
  process.exit(1)
}

if (!/^[a-zA-Z0-9_]{1,15}$/.test(name)) {
  console.error(`Error: invalid name "${name}"`)
  console.error("Name must be 1–15 characters, letters/numbers/underscores only.")
  process.exit(1)
}

const client = new GameClient()
console.log(`Wallet: ${client.address}`)
console.log(`Setting name to: ${name}`)

try {
  const result = await client.setInfo(name)
  console.log(`Done — agent_name: ${result.agentName}, agent_type: ${result.agentType}`)
} catch (err) {
  console.error(`Error: ${(err as Error).message}`)
  process.exit(1)
}
