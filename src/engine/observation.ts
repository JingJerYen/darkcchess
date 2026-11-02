import { other } from './rules';
import { repToKeys } from './game';
import type { GameResult, GameState, Piece, Rank, RulesConfig, Side } from './types';

export interface ObsCell {
  readonly side: Side;
  readonly faceUp: boolean;
  /** null for the opponent's face-down pieces. */
  readonly rank: Rank | null;
}

/**
 * What one side is allowed to know. Contains no opponent hidden ranks and no
 * pool ordering (own pool is given as a sorted multiset).
 */
export interface Observation {
  readonly viewer: Side;
  readonly toMove: Side;
  readonly board: readonly (ObsCell | null)[];
  /** Own pool composition, sorted ascending (order is hidden even from the owner). */
  readonly myPool: readonly Rank[];
  readonly poolCounts: { readonly red: number; readonly black: number };
  /** Face-down piece count on the board per owner. */
  readonly hiddenCounts: { readonly red: number; readonly black: number };
  /** Captured pieces per owner, sorted ascending. */
  readonly captured: { readonly red: readonly Rank[]; readonly black: readonly Rank[] };
  /** The viewer's freshly drawn piece (only when the viewer must place it). */
  readonly pending: Piece | null;
  /** True when the opponent has drawn and is about to place. */
  readonly opponentPending: boolean;
  /** Position keys since the last irreversible action, oldest first. */
  readonly repHistory: readonly string[];
  readonly ply: number;
  readonly rules: RulesConfig;
  readonly result: GameResult | null;
}

const asc = (a: number, b: number) => a - b;

export function observationFor(state: GameState, side: Side): Observation {
  const board = state.board.map((c) =>
    c === null ? null : { side: c.side, faceUp: c.faceUp, rank: c.faceUp || c.side === side ? c.rank : null },
  );
  const hiddenCounts = { red: 0, black: 0 };
  for (const c of state.board) if (c !== null && !c.faceUp) hiddenCounts[c.side]++;
  const pendingMine = state.pending !== null && state.pending.side === side;
  return {
    viewer: side,
    toMove: state.toMove,
    board,
    myPool: [...state.pools[side]].sort(asc) as Rank[],
    poolCounts: { red: state.pools.red.length, black: state.pools.black.length },
    hiddenCounts,
    captured: {
      red: [...state.captured.red].sort(asc) as Rank[],
      black: [...state.captured.black].sort(asc) as Rank[],
    },
    pending: pendingMine ? { side: state.pending!.side, rank: state.pending!.rank } : null,
    opponentPending: state.pending !== null && state.pending.side === other(side),
    repHistory: repToKeys(state.rep),
    ply: state.ply,
    rules: { ...state.rules },
    result: state.result,
  };
}
