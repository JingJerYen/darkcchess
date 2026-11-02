/**
 * All tunable constants of the search bot live here. The values are starting
 * points; tune them with `npm run arena` (see README).
 */
import type { Rank } from '../engine';

/** Material value of each rank (7 帥 … 1 兵). */
export const PIECE_VALUE: Readonly<Record<Rank, number>> = {
  7: 7, // 帥/將
  6: 5, // 仕/士
  5: 4, // 相/象
  4: 5, // 俥/車
  3: 3, // 傌/馬
  2: 4, // 炮/包
  1: 1, // 兵/卒
};

/** Multiplier for pieces still in the pool (and a drawn-but-unplaced piece). */
export const POOL_FACTOR = 0.8;
/** Multiplier for face-down pieces on the board (immobile but safe). */
export const HIDDEN_FACTOR = 0.9;
/** Weight of (own legal action count − opponent legal action count). 0 disables it. */
export const MOBILITY_WEIGHT = 0;
/** Logistic slope turning a material difference into a win probability. */
export const LOGISTIC_SCALE = 0.35;

/** Rollout policy weights (relative, un-normalised). */
export const ROLLOUT = {
  /** Default weight of any legal action. */
  base: 1,
  /** Capture weight = capture + captureValue * value(victim). */
  capture: 6,
  captureValue: 1,
  /** Face-up placement onto a square the opponent can capture next move. */
  placeAttacked: 0.05,
  /** Flipping a face-down piece that belongs to the opponent. */
  flipOpponent: 0.3,
  /** Non-capturing move into an attacked square. */
  moveIntoDanger: 0.3,
  /** Moving a currently attacked piece to a safe square. */
  escape: 3,
} as const;

/** Extra expansion-order bonus (not used in rollouts). */
export const EXPANSION = {
  /** Face-up placement that is safe and threatens a capture next turn. */
  placeThreat: 3,
  /** Random jitter (multiplicative) used to break ties in expansion order. */
  jitter: 0.5,
} as const;

/** Search defaults. */
export const SEARCH = {
  uctC: 1.0,
  maxRolloutPlies: 30,
  /** Progressive widening: a node with n visits may have ceil(pwC * n^pwAlpha) children. */
  pwC: 2,
  pwAlpha: 0.5,
} as const;
