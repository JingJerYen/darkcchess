import { PIECE_VALUE, ROLLOUT, EXPANSION, POOL_FACTOR, HIDDEN_FACTOR, MOBILITY_WEIGHT, LOGISTIC_SCALE } from './evalWeights';
import { isAttacked, legalActions, pushPieceMoves, other } from '../engine';
import type { Action, Cell, GameState, RNG, Side } from '../engine';

/** Heuristic weight of an action, used by rollouts (and as expansion order). */
export function actionWeight(state: GameState, a: Action): number {
  const b = state.board;
  const side = state.toMove;
  switch (a.type) {
    case 'draw':
      return ROLLOUT.base;
    case 'place': {
      if (!a.faceUp) return ROLLOUT.base;
      const p = state.pending!;
      return isAttacked(b, a.to, side, p.rank, state.rules) ? ROLLOUT.placeAttacked : ROLLOUT.base;
    }
    case 'flip':
      return b[a.at]!.side === side ? ROLLOUT.base : ROLLOUT.flipOpponent;
    case 'move': {
      const t = b[a.to];
      if (t !== null) return ROLLOUT.capture + ROLLOUT.captureValue * PIECE_VALUE[t.rank];
      const p = b[a.from]!;
      if (isAttacked(b, a.to, side, p.rank, state.rules, a.from)) return ROLLOUT.moveIntoDanger;
      if (isAttacked(b, a.from, side, p.rank, state.rules)) return ROLLOUT.escape;
      return ROLLOUT.base;
    }
  }
}

export function pickWeighted<T>(items: readonly T[], weights: readonly number[], rng: RNG): T {
  let total = 0;
  for (const w of weights) total += w;
  let x = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

const QUIET_W_MAX = Math.max(
  ROLLOUT.base,
  ROLLOUT.escape,
  ROLLOUT.flipOpponent,
  ROLLOUT.placeAttacked,
  ROLLOUT.moveIntoDanger,
);

/**
 * Rollout policy. Captures are weighted by ROLLOUT.capture (+victim value);
 * the other actions are sampled with weight ∝ actionWeight via rejection
 * sampling, so only a few attack checks are needed per step. The capture /
 * non-capture split treats every non-capture as weight `base`.
 */
export function rolloutAction(state: GameState, rng: RNG): Action {
  const b = state.board;
  if (state.pending !== null) return rolloutPlacement(state, rng);
  const acts = legalActions(state);
  let capW = 0;
  let nCap = 0;
  for (const a of acts) {
    if (a.type === 'move' && b[a.to] !== null) {
      capW += ROLLOUT.capture + ROLLOUT.captureValue * PIECE_VALUE[b[a.to]!.rank];
      nCap++;
    }
  }
  const nQuiet = acts.length - nCap;
  if (nCap > 0 && rng.next() * (capW + nQuiet * ROLLOUT.base) < capW) {
    let x = rng.next() * capW;
    let last: Action = acts[0];
    for (const a of acts) {
      if (a.type === 'move' && b[a.to] !== null) {
        last = a;
        x -= ROLLOUT.capture + ROLLOUT.captureValue * PIECE_VALUE[b[a.to]!.rank];
        if (x < 0) return a;
      }
    }
    return last;
  }
  const quiet = nCap === 0 ? acts : acts.filter((a) => !(a.type === 'move' && b[a.to] !== null));
  const wMax = QUIET_W_MAX;
  let cand = quiet[0];
  for (let tries = 0; tries < 12; tries++) {
    cand = quiet[rng.int(quiet.length)];
    if (rng.next() * wMax < actionWeight(state, cand)) return cand;
  }
  return cand;
}

/** Placement sampling without materialising all 2×empties actions. */
function rolloutPlacement(state: GameState, rng: RNG): Action {
  const b = state.board;
  const empties: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] === null) empties.push(i);
  const p = state.pending!;
  const wMax = Math.max(ROLLOUT.base, ROLLOUT.placeAttacked);
  let a: Action = { type: 'place', to: empties[0], faceUp: false };
  for (let tries = 0; tries < 12; tries++) {
    const to = empties[rng.int(empties.length)];
    const faceUp = rng.next() < 0.5;
    a = { type: 'place', to, faceUp };
    const w = !faceUp ? ROLLOUT.base : isAttacked(b, to, p.side, p.rank, state.rules) ? ROLLOUT.placeAttacked : ROLLOUT.base;
    if (rng.next() * wMax < w) return a;
  }
  return a;
}

/** Does a face-up placement threaten an immediate capture? */
function placementThreatens(state: GameState, to: number): boolean {
  const p = state.pending!;
  const board: Cell[] = state.board.slice();
  board[to] = { side: p.side, rank: p.rank, faceUp: true };
  const out: Action[] = [];
  pushPieceMoves(board, to, state.rules, out);
  return out.some((m) => m.type === 'move' && board[m.to] !== null);
}

/** Legal actions ordered best-first for progressive widening. */
export function orderedActions(state: GameState, rng: RNG): Action[] {
  const acts = legalActions(state);
  const scored = acts.map((a) => {
    let w = actionWeight(state, a);
    if (a.type === 'place' && a.faceUp && w >= ROLLOUT.base && placementThreatens(state, a.to)) {
      w += EXPANSION.placeThreat;
    }
    return { a, s: w * (1 + EXPANSION.jitter * rng.next()) };
  });
  scored.sort((x, y) => y.s - x.s);
  return scored.map((x) => x.a);
}

function material(state: GameState, side: Side): number {
  let v = 0;
  for (const c of state.board) {
    if (c !== null && c.side === side) v += c.faceUp ? PIECE_VALUE[c.rank] : PIECE_VALUE[c.rank] * HIDDEN_FACTOR;
  }
  for (const r of state.pools[side]) v += PIECE_VALUE[r] * POOL_FACTOR;
  if (state.pending !== null && state.pending.side === side) v += PIECE_VALUE[state.pending.rank] * POOL_FACTOR;
  return v;
}

/** Heuristic score difference (red − black). */
export function evalDiff(state: GameState): number {
  let d = material(state, 'red') - material(state, 'black');
  if (MOBILITY_WEIGHT !== 0 && state.pending === null) {
    const mine = legalActions(state).length;
    const theirs = legalActions({ ...state, toMove: other(state.toMove) }).length;
    d += MOBILITY_WEIGHT * (state.toMove === 'red' ? mine - theirs : theirs - mine);
  }
  return d;
}

/** Red's win probability in [0,1]. Terminal states give 1 / 0 / 0.5. */
export function evaluateRed(state: GameState): number {
  if (state.result !== null) {
    if (state.result.winner === null) return 0.5;
    return state.result.winner === 'red' ? 1 : 0;
  }
  return 1 / (1 + Math.exp(-LOGISTIC_SCALE * evalDiff(state)));
}
