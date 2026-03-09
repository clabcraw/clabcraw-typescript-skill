/**
 * Typed error classes for Clabcraw operations.
 *
 * All errors extend ClabcrawError and carry machine-readable fields
 * so you can branch on error type without parsing strings:
 *
 *   try { await client.join("poker") }
 *   catch (err) {
 *     if (err instanceof InsufficientFundsError) { console.log("Need more USDC") }
 *     if (err.retriable) { await sleep(err.retryAfterMs); retry() }
 *   }
 */

export class ClabcrawError extends Error {
  readonly code: string
  readonly retriable: boolean
  readonly retryAfterMs: number
  readonly context: unknown

  constructor(
    message: string,
    { code = "UNKNOWN", retriable = false, retryAfterMs = 5_000, context }: {
      code?: string
      retriable?: boolean
      retryAfterMs?: number
      context?: unknown
    } = {}
  ) {
    super(message)
    this.name = "ClabcrawError"
    this.code = code
    this.retriable = retriable
    this.retryAfterMs = retryAfterMs
    this.context = context
  }
}

/** Platform is paused for maintenance. code: PAUSED */
export class PausedError extends ClabcrawError {
  constructor(
    message = "Platform is temporarily paused for maintenance",
    { retryAfterMs = 30_000, context, retriable = true }: {
      retryAfterMs?: number
      context?: unknown
      retriable?: boolean
    } = {}
  ) {
    super(message, { code: "PAUSED", retriable, retryAfterMs, context })
    this.name = "PausedError"
  }
}

/** Wallet doesn't have enough USDC to pay the entry fee. code: INSUFFICIENT_FUNDS */
export class InsufficientFundsError extends ClabcrawError {
  constructor(message = "Insufficient USDC balance to pay entry fee", { context }: { context?: unknown } = {}) {
    super(message, { code: "INSUFFICIENT_FUNDS", retriable: false, context })
    this.name = "InsufficientFundsError"
  }
}

/** Action submitted when it's the opponent's turn. code: NOT_YOUR_TURN */
export class NotYourTurnError extends ClabcrawError {
  constructor(message = "It is not your turn", { context }: { context?: unknown } = {}) {
    super(message, { code: "NOT_YOUR_TURN", retriable: true, retryAfterMs: 1_000, context })
    this.name = "NotYourTurnError"
  }
}

/** Action not in valid_actions for the current state. code: INVALID_ACTION */
export class InvalidActionError extends ClabcrawError {
  constructor(message = "Action is not valid in the current game state", { context }: { context?: unknown } = {}) {
    super(message, { code: "INVALID_ACTION", retriable: false, context })
    this.name = "InvalidActionError"
  }
}

/** Game not found (404). code: GAME_NOT_FOUND */
export class GameNotFoundError extends ClabcrawError {
  constructor(gameId: string, { context }: { context?: unknown } = {}) {
    super(`Game not found: ${gameId}`, { code: "GAME_NOT_FOUND", retriable: false, context })
    this.name = "GameNotFoundError"
  }
}

/** Network error (fetch failed, timeout, etc.). code: NETWORK_ERROR */
export class NetworkError extends ClabcrawError {
  constructor(message = "Network request failed", { retryAfterMs = 3_000, context }: { retryAfterMs?: number; context?: unknown } = {}) {
    super(message, { code: "NETWORK_ERROR", retriable: true, retryAfterMs, context })
    this.name = "NetworkError"
  }
}

/** Game type is disabled or unknown. code: GAME_DISABLED */
export class GameDisabledError extends ClabcrawError {
  readonly availableGames: string[]

  constructor(
    message = "Game type is currently disabled",
    { availableGames = [], context }: { availableGames?: string[]; context?: unknown } = {}
  ) {
    super(message, { code: "GAME_DISABLED", retriable: false, context })
    this.name = "GameDisabledError"
    this.availableGames = availableGames
  }
}

/** Request signature verification failed (401). code: AUTH_ERROR */
export class AuthError extends ClabcrawError {
  constructor(message = "Request signature verification failed", { context }: { context?: unknown } = {}) {
    super(message, { code: "AUTH_ERROR", retriable: false, context })
    this.name = "AuthError"
  }
}

/**
 * Build the appropriate typed error from an HTTP response.
 */
export async function fromResponse(response: Response, gameId?: string): Promise<ClabcrawError> {
  let body: Record<string, unknown>
  try {
    body = await response.json() as Record<string, unknown>
  } catch {
    body = { error: response.statusText }
  }

  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"))

  switch (response.status) {
    case 400:
      if (Array.isArray(body?.available_games)) {
        return new GameDisabledError(String(body?.error ?? "Game type is disabled"), {
          availableGames: body.available_games as string[],
          context: body,
        })
      }
      return new ClabcrawError(String(body?.error ?? "Bad request"), {
        code: "BAD_REQUEST",
        retriable: false,
        context: body,
      })

    case 401:
      return new AuthError(String(body?.error ?? "Unauthorized"), { context: body })

    case 402:
      return new InsufficientFundsError(String(body?.error ?? "Payment required"), { context: body })

    case 404:
      return new GameNotFoundError(gameId ?? "unknown", { context: body })

    case 409:
      return new ClabcrawError(String(body?.error ?? "Conflict"), {
        code: "MATCHING_IN_PROGRESS",
        retriable: false,
        context: body,
      })

    case 422:
      return new InvalidActionError(String(body?.error ?? "Invalid action"), { context: body })

    case 503: {
      const msg = String(body?.message ?? body?.error ?? "Platform is paused for maintenance")
      const retriable = body?.retryable === true
      return new PausedError(msg, { retryAfterMs, context: body, retriable })
    }

    default:
      return new ClabcrawError(
        String(body?.error ?? `Unexpected HTTP ${response.status}`),
        { code: "HTTP_ERROR", retriable: response.status >= 500, retryAfterMs, context: body }
      )
  }
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 5_000
  const seconds = parseInt(header, 10)
  if (!isNaN(seconds)) return seconds * 1_000
  const date = new Date(header)
  if (!isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now())
  return 5_000
}
