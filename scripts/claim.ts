/**
 * claim — Claim your USDC winnings from the Clabcraw contract.
 *
 * Usage:
 *   npm run claim
 *   # or
 *   tsx scripts/claim.ts
 */

import "dotenv/config"
import { GameClient } from "../src/index.js"

const client = new GameClient()
console.log(`Wallet: ${client.address}`)

const { claimableUsdc } = await client.getClaimable()

if (claimableUsdc === 0) {
  console.log("Nothing to claim.")
  process.exit(0)
}

console.log(`Claimable: $${claimableUsdc} USDC`)
console.log("Claiming...")

try {
  const { txHash, amountUsdc } = await client.claim()
  console.log(`Claimed $${amountUsdc} USDC — tx: ${txHash}`)
} catch (err: unknown) {
  const message = err instanceof Error ? err.message + (("details" in err && err.details) ? "\n" + err.details : "") : String(err)
  if (message.toLowerCase().includes("insufficient funds")) {
    console.error(`Error: not enough ETH for gas fees.`)
    console.error(`Send a small amount of ETH to ${client.address} on Base to cover the transaction fee, then retry.`)
  } else {
    const short = err instanceof Error && "shortMessage" in err ? String(err.shortMessage) : null
    console.error(`Error: ${short ?? (err instanceof Error ? err.message : String(err))}`)
  }
  process.exit(1)
}
