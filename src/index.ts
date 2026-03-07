// Public API

export { GameClient, GameLoop } from "./game.js"
export { normalizeState, parseCard } from "./schema.js"
export { estimateEquity, handRank, describeHand, countOuts, potOdds, shouldCall, suggestBetSize } from "./strategy.js"
export {
  ClabcrawError,
  PausedError,
  InsufficientFundsError,
  NotYourTurnError,
  InvalidActionError,
  GameNotFoundError,
  NetworkError,
  GameDisabledError,
  AuthError,
} from "./errors.js"

export type {
  Card,
  ChessPiece,
  ChessPieceType,
  ChessColor,
  PokerAction,
  ChessAction,
  GameAction,
  FoldAction,
  CheckAction,
  CallAction,
  RaiseAction,
  AllInAction,
  MoveAction,
  ResignAction,
  ActionInfo,
  ActionMap,
  NormalizedState,
  Strategy,
  GameType,
  ClientConfig,
  GameLoopConfig,
  JoinResult,
  AgentStatus,
  ClaimResult,
  ClaimableResult,
} from "./types.js"
