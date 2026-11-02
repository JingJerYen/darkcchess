import { DEFAULT_RULES, PIECE_SET, positionKey, sq } from '../src/engine';
import type { Cell, GameState, Rank, RulesConfig, Side, Action } from '../src/engine';

const UP: Record<string, Rank> = { K: 7, A: 6, B: 5, R: 4, N: 3, C: 2, P: 1 };

/**
 * Build a state from 4 strings of 8 chars.
 * Uppercase = red face-up, lowercase = black face-up (K A B R N C P),
 * 'X' / 'x' = red / black face-down (rank from `hidden` or pawn), '.' = empty.
 */
export function mk(
  rows: string[],
  opts: {
    toMove?: Side;
    pools?: { red?: Rank[]; black?: Rank[] };
    rules?: Partial<RulesConfig>;
    hidden?: Record<number, Rank>;
  } = {},
): GameState {
  const board: Cell[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = rows[r][c];
      if (ch === '.') board.push(null);
      else if (ch === 'X' || ch === 'x') {
        board.push({ side: ch === 'X' ? 'red' : 'black', rank: opts.hidden?.[sq(r, c)] ?? 1, faceUp: false });
      } else {
        const rank = UP[ch.toUpperCase()];
        if (!rank) throw new Error(`bad char ${ch}`);
        board.push({ side: ch === ch.toUpperCase() ? 'red' : 'black', rank, faceUp: true });
      }
    }
  }
  const base: GameState = {
    board,
    pools: { red: opts.pools?.red ?? [], black: opts.pools?.black ?? [] },
    captured: { red: [], black: [] },
    toMove: opts.toMove ?? 'red',
    pending: null,
    ply: 0,
    rules: { ...DEFAULT_RULES, ...opts.rules },
    rep: null,
    result: null,
    lastAction: null,
  };
  return { ...base, rep: { key: positionKey(base), prev: null } };
}

export const mv = (from: number, to: number): Action => ({ type: 'move', from, to });

/** Mark every piece that is neither on the board nor in a pool as captured. */
export function completeWithCaptured(s: GameState): GameState {
  const missing = (side: Side): Rank[] => {
    const left = [...PIECE_SET];
    const present = [...s.board.filter((c) => c && c.side === side).map((c) => c!.rank), ...s.pools[side]];
    for (const r of present) left.splice(left.indexOf(r), 1);
    return left;
  };
  return { ...s, captured: { red: missing('red'), black: missing('black') } };
}
