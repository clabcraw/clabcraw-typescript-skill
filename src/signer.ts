/**
 * Wallet setup and EIP-191 signing for Clabcraw game requests.
 *
 * Signs the message: "{game_id}:{canonical_json}:{timestamp}"
 * using viem's signMessage (EIP-191 personal_sign).
 *
 * JSON keys MUST be sorted alphabetically to match the server's
 * Jason.encode!/1 output (Elixir sorts map keys by default).
 */

import { x402Client, wrapFetchWithPayment } from "@x402/fetch"
import { registerExactEvmScheme } from "@x402/evm/exact/client"
import { privateKeyToAccount } from "viem/accounts"
import type { PrivateKeyAccount } from "viem/accounts"

export type Signer = PrivateKeyAccount

/**
 * Create a viem account from a hex private key.
 * Accepts keys with or without "0x" prefix.
 */
export function createSigner(privateKey: string): Signer {
  const key = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`
  return privateKeyToAccount(key)
}

/**
 * Create a fetch function that automatically handles x402 payment flows.
 * When a request returns HTTP 402, the wrapper signs a USDC authorization
 * and retries with the payment-signature header.
 */
export function createPaymentFetch(signer: Signer): typeof fetch {
  const client = new x402Client()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerExactEvmScheme(client, { signer: signer as any })
  return wrapFetchWithPayment(fetch, client) as typeof fetch
}

/**
 * Sign a game action with EIP-191.
 * Message format: "{gameId}:{canonical_json}:{timestamp}"
 */
export async function signAction(
  account: Signer,
  gameId: string,
  actionBody: Record<string, unknown>,
  timestamp: string
): Promise<string> {
  const message = buildMessage(gameId, actionBody, timestamp)
  return account.signMessage({ message })
}

/**
 * Sign a game state read request with EIP-191.
 */
export async function signState(account: Signer, gameId: string, timestamp: string): Promise<string> {
  return signAction(account, gameId, { action: "state" }, timestamp)
}

/**
 * Sign a queue cancellation request.
 * Message format: "cancel-queue:{gameId}:{timestamp}"
 * Distinct prefix prevents replaying cancel signatures as action/state requests.
 */
export async function signCancel(account: Signer, gameId: string, timestamp: string): Promise<string> {
  const message = `cancel-queue:${gameId}:${timestamp}`
  return account.signMessage({ message })
}

/**
 * Sign an agent info update (PUT /v1/agent/{address}/info).
 * Message format: "{address}:{canonical_json}:{timestamp}"
 * Note: uses the wallet address as the subject, not a game ID.
 */
export async function signInfo(
  account: Signer,
  body: Record<string, unknown>,
  timestamp: string
): Promise<string> {
  const message = `${account.address}:${canonicalize(body)}:${timestamp}`
  return account.signMessage({ message })
}

/**
 * Produce canonical JSON matching Elixir's Jason.encode!/1.
 * Keys are sorted alphabetically, no whitespace.
 */
function canonicalize(obj: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
  )
  return JSON.stringify(sorted)
}

function buildMessage(gameId: string, payload: Record<string, unknown>, timestamp: string): string {
  return `${gameId}:${canonicalize(payload)}:${timestamp}`
}
