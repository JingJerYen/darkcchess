import type { Cell, Rank, RulesConfig, Side, Square } from './types';

/** Experiment switch (see README §4). Default rules value for new games. */
export const CHARIOT_CHARGE_CAPTURES_ANY = false;

export const DEFAULT_RULES: RulesConfig = {
  chariotChargeCapturesAny: CHARIOT_CHARGE_CAPTURES_ANY,
};

export const ROWS = 4;
export const COLS = 8;
export const SQUARES = ROWS * COLS;

export const KING: Rank = 7;
export const ADVISOR: Rank = 6;
export const ELEPHANT: Rank = 5;
export const CHARIOT: Rank = 4;
export const HORSE: Rank = 3;
export const CANNON: Rank = 2;
export const PAWN: Rank = 1;

export const ALL_RANKS: readonly Rank[] = [7, 6, 5, 4, 3, 2, 1];

/** Pieces per side, as a multiset of ranks. */
export const PIECE_SET: readonly Rank[] = [7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 1];

export const RANK_COUNT: Readonly<Record<Rank, number>> = { 7: 1, 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 };

export const PIECE_NAMES: Readonly<Record<Side, Readonly<Record<Rank, string>>>> = {
  red: { 7: '帥', 6: '仕', 5: '相', 4: '俥', 3: '傌', 2: '炮', 1: '兵' },
  black: { 7: '將', 6: '士', 5: '象', 4: '車', 3: '馬', 2: '包', 1: '卒' },
};

export const SIDE_NAMES: Readonly<Record<Side, string>> = { red: '紅方', black: '黑方' };

export function other(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}

export function sq(row: number, col: number): Square {
  return row * COLS + col;
}
export function rowOf(s: Square): number {
  return Math.floor(s / COLS);
}
export function colOf(s: Square): number {
  return s % COLS;
}

/**
 * Generic rank rule for a capture by stepping (and, unless the flag is set,
 * by chariot charge). Cannons never capture by stepping.
 */
export function canCapture(attacker: Rank, target: Rank): boolean {
  if (attacker === CANNON) return false;
  if (attacker === PAWN) return target === PAWN || target === KING;
  if (attacker === KING) return target !== PAWN;
  return attacker >= target;
}

/** RAYS[s][d] = squares walking from s in direction d (up, down, left, right), nearest first. */
export const RAYS: readonly (readonly (readonly Square[])[])[] = (() => {
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const out: Square[][][] = [];
  for (let s = 0; s < SQUARES; s++) {
    const r0 = rowOf(s);
    const c0 = colOf(s);
    out.push(
      dirs.map(([dr, dc]) => {
        const ray: Square[] = [];
        let r = r0 + dr;
        let c = c0 + dc;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
          ray.push(sq(r, c));
          r += dr;
          c += dc;
        }
        return ray;
      }),
    );
  }
  return out;
})();

/**
 * Would a face-up piece of `side`/`rank` standing on `at` be capturable by the
 * opponent on their next move? `vacated` is treated as empty (use it when the
 * piece is moving away from that square).
 */
export function isAttacked(
  board: readonly Cell[],
  at: Square,
  side: Side,
  rank: Rank,
  rules: RulesConfig,
  vacated: Square = -1,
): boolean {
  const rays = RAYS[at];
  for (let d = 0; d < 4; d++) {
    const ray = rays[d];
    let i = 0;
    let first: Cell = null;
    for (; i < ray.length; i++) {
      if (ray[i] === vacated) continue;
      const c = board[ray[i]];
      if (c !== null) {
        first = c;
        break;
      }
    }
    if (first === null) continue;
    if (first.faceUp && first.side !== side) {
      if (i === 0) {
        if (canCapture(first.rank, rank)) return true;
      } else if (first.rank === CHARIOT && (rules.chariotChargeCapturesAny || canCapture(CHARIOT, rank))) {
        return true;
      }
    }
    // Look for a cannon behind the screen.
    for (i = i + 1; i < ray.length; i++) {
      if (ray[i] === vacated) continue;
      const c = board[ray[i]];
      if (c !== null) {
        if (c.faceUp && c.side !== side && c.rank === CANNON) return true;
        break;
      }
    }
  }
  return false;
}
