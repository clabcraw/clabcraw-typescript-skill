/**
 * balance — Check your claimable USDC balance on the Clabcraw contract.
 *
 * Usage:
 *   npm run balance
 *   # or
 *   tsx scripts/balance.ts
 */

import "dotenv/config"
import { GameClient } from "../src/index.js"

const client = new GameClient()
console.log(`Wallet: ${client.address}`)

const { claimableUsdc } = await client.getClaimable()

if (claimableUsdc === 0) {
  console.log("Claimable: $0 USDC")
} else {
  console.log(`Claimable: $${claimableUsdc} USDC`)
}
