import { PIECE_SET, SQUARES, other, positionKey, repFromKeys, shuffleInPlace } from '../engine';
import type { Cell, GameState, Observation, Piece, RNG, Rank } from '../engine';

/** Ranks of the opponent not visible to the viewer (multiset U). */
export function unknownOpponentRanks(obs: Observation): Rank[] {
  const opp = other(obs.viewer);
  const counts = new Map<Rank, number>();
  for (const r of PIECE_SET) counts.set(r, (counts.get(r) ?? 0) + 1);
  const take = (r: Rank) => {
    const n = counts.get(r) ?? 0;
    if (n <= 0) throw new Error(`determinize: too many visible opponent pieces of rank ${r}`);
    counts.set(r, n - 1);
  };
  for (const c of obs.board) if (c !== null && c.side === opp && c.faceUp) take(c.rank!);
  for (const r of obs.captured[opp]) take(r);
  const out: Rank[] = [];
  for (const [r, n] of counts) for (let i = 0; i < n; i++) out.push(r);
  return out.sort((a, b) => a - b);
}

/**
 * Sample a full game state consistent with `obs`: the unknown opponent ranks
 * are shuffled uniformly and dealt to the opponent's face-down pieces (and its
 * pending draw, if any); the rest become the opponent's pool.
 */
export function determinize(obs: Observation, rng: RNG): GameState {
  const me = obs.viewer;
  const opp = other(me);
  const U = unknownOpponentRanks(obs);
  const oppHidden = obs.board.filter((c) => c !== null && c.side === opp && !c.faceUp).length;
  const need = oppHidden + obs.poolCounts[opp] + (obs.opponentPending ? 1 : 0);
  if (U.length !== need) {
    throw new Error(`determinize: |U|=${U.length} but hidden+pool=${need}`);
  }
  shuffleInPlace(U, rng);
  let k = 0;
  const board: Cell[] = new Array(SQUARES);
  for (let s = 0; s < SQUARES; s++) {
    const c = obs.board[s];
    if (c === null) board[s] = null;
    else if (c.rank !== null) board[s] = { side: c.side, rank: c.rank, faceUp: c.faceUp };
    else board[s] = { side: c.side, rank: U[k++], faceUp: false };
  }
  let pending: Piece | null = obs.pending;
  if (obs.opponentPending) pending = { side: opp, rank: U[k++] };
  const oppPool = U.slice(k);
  const myPool = obs.myPool.slice();
  const state: GameState = {
    board,
    pools: me === 'red' ? { red: myPool, black: oppPool } : { red: oppPool, black: myPool },
    captured: { red: obs.captured.red.slice(), black: obs.captured.black.slice() },
    toMove: obs.toMove,
    pending,
    ply: obs.ply,
    rules: { ...obs.rules },
    rep: null,
    result: obs.result,
    lastAction: null,
  };
  const keys = obs.repHistory.length > 0 ? obs.repHistory : pending === null ? [positionKey(state)] : [];
  return { ...state, rep: repFromKeys(keys) };
}

/** Pick a rank from a pool uniformly, independent of the pool's order. */
export function sampleRank(pool: readonly Rank[], rng: RNG): Rank {
  // Count per rank in fixed rank order so the result depends only on the multiset.
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const r of pool) counts[r]++;
  let x = rng.int(pool.length);
  for (let r = 1; r <= 7; r++) {
    if (x < counts[r]) return r as Rank;
    x -= counts[r];
  }
  throw new Error('sampleRank: empty pool');
}
