import {
  CANNON,
  CHARIOT,
  DEFAULT_RULES,
  PIECE_SET,
  RAYS,
  SQUARES,
  canCapture,
  other,
} from './rules';
import { SeededRng, shuffleInPlace } from './rng';
import type {
  Action,
  ActionRecord,
  BoardPiece,
  CaptureKind,
  Cell,
  GameResult,
  GameState,
  Piece,
  Rank,
  RepNode,
  RulesConfig,
  Side,
  Square,
} from './types';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function newGame(seed: number, rules: Partial<RulesConfig> = {}): GameState {
  const rng = new SeededRng(seed);
  const red = shuffleInPlace([...PIECE_SET], rng);
  const black = shuffleInPlace([...PIECE_SET], rng);
  const base: GameState = {
    board: new Array<Cell>(SQUARES).fill(null),
    pools: { red, black },
    captured: { red: [], black: [] },
    toMove: 'red',
    pending: null,
    ply: 0,
    rules: { ...DEFAULT_RULES, ...rules },
    rep: null,
    result: null,
    lastAction: null,
  };
  return { ...base, rep: { key: positionKey(base), prev: null } };
}

export function repFromKeys(keys: readonly string[]): RepNode | null {
  let node: RepNode | null = null;
  for (const key of keys) node = { key, prev: node };
  return node;
}

export function repToKeys(rep: RepNode | null): string[] {
  const out: string[] = [];
  for (let n = rep; n !== null; n = n.prev) out.push(n.key);
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Position key
// ---------------------------------------------------------------------------

// rank -> char. index by rank (1..7).
const UP_RED = ['', 'P', 'C', 'N', 'R', 'B', 'A', 'K'];
const UP_BLACK = ['', 'p', 'c', 'n', 'r', 'b', 'a', 'k'];

/**
 * Key for repetition detection: every cell (piece + face state; a face-down
 * piece is identified by its owner only, which is all that is observable),
 * both pool sizes and the side to move.
 */
export function positionKey(state: GameState): string {
  let s = '';
  const b = state.board;
  for (let i = 0; i < SQUARES; i++) {
    const c = b[i];
    if (c === null) s += '.';
    else if (!c.faceUp) s += c.side === 'red' ? 'X' : 'x';
    else s += c.side === 'red' ? UP_RED[c.rank] : UP_BLACK[c.rank];
  }
  return `${s}|${state.pools.red.length}|${state.pools.black.length}|${state.toMove === 'red' ? 'r' : 'b'}`;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

export function actionKey(a: Action): string {
  switch (a.type) {
    case 'draw':
      return 'd';
    case 'place':
      return `p${a.to}${a.faceUp ? 'u' : 'h'}`;
    case 'flip':
      return `f${a.at}`;
    case 'move':
      return `m${a.from}-${a.to}`;
  }
}

/** Push all move/capture actions of the face-up piece on `from`. */
export function pushPieceMoves(board: readonly Cell[], from: Square, rules: RulesConfig, out: Action[]): void {
  const p = board[from];
  if (p === null || !p.faceUp) return;
  const rays = RAYS[from];
  for (let d = 0; d < 4; d++) {
    const ray = rays[d];
    if (ray.length === 0) continue;
    const n = ray[0];
    const c = board[n];
    if (c === null) {
      out.push({ type: 'move', from, to: n });
    } else if (p.rank !== CANNON && c.faceUp && c.side !== p.side && canCapture(p.rank, c.rank)) {
      out.push({ type: 'move', from, to: n });
    }
    if (p.rank === CANNON) {
      let i = 0;
      while (i < ray.length && board[ray[i]] === null) i++;
      // ray[i] is the screen
      i++;
      while (i < ray.length && board[ray[i]] === null) i++;
      if (i < ray.length) {
        const t = board[ray[i]]!;
        if (t.faceUp && t.side !== p.side) out.push({ type: 'move', from, to: ray[i] });
      }
    } else if (p.rank === CHARIOT && c === null) {
      let i = 1;
      while (i < ray.length && board[ray[i]] === null) i++;
      if (i < ray.length) {
        const t = board[ray[i]]!;
        if (t.faceUp && t.side !== p.side && (rules.chariotChargeCapturesAny || canCapture(CHARIOT, t.rank))) {
          out.push({ type: 'move', from, to: ray[i] });
        }
      }
    }
  }
}

function pieceHasMove(board: readonly Cell[], from: Square, rules: RulesConfig): boolean {
  const tmp: Action[] = [];
  pushPieceMoves(board, from, rules, tmp);
  return tmp.length > 0;
}

export function legalActions(state: GameState): Action[] {
  const out: Action[] = [];
  if (state.result !== null) return out;
  const b = state.board;
  if (state.pending !== null) {
    for (let s = 0; s < SQUARES; s++) {
      if (b[s] === null) {
        out.push({ type: 'place', to: s, faceUp: true });
        out.push({ type: 'place', to: s, faceUp: false });
      }
    }
    return out;
  }
  const side = state.toMove;
  let hasEmpty = false;
  for (let s = 0; s < SQUARES; s++) {
    const c = b[s];
    if (c === null) hasEmpty = true;
    else if (!c.faceUp) out.push({ type: 'flip', at: s });
    else if (c.side === side) pushPieceMoves(b, s, state.rules, out);
  }
  if (hasEmpty && state.pools[side].length > 0) out.unshift({ type: 'draw' });
  return out;
}

/** Fast check used for the loss condition. Ignores `pending`/`result`. */
export function hasAnyLegalAction(state: GameState): boolean {
  const b = state.board;
  const side = state.toMove;
  const poolNonEmpty = state.pools[side].length > 0;
  for (let s = 0; s < SQUARES; s++) {
    const c = b[s];
    if (c === null) {
      if (poolNonEmpty) return true;
    } else if (!c.faceUp) return true;
  }
  for (let s = 0; s < SQUARES; s++) {
    const c = b[s];
    if (c !== null && c.faceUp && c.side === side && pieceHasMove(b, s, state.rules)) return true;
  }
  return false;
}

export function isLegalAction(state: GameState, action: Action): boolean {
  const k = actionKey(action);
  return legalActions(state).some((a) => actionKey(a) === k);
}

// ---------------------------------------------------------------------------
// Applying actions
// ---------------------------------------------------------------------------

/** Applies a legal action, returning a new state. Throws on illegal actions. */
export function applyAction(state: GameState, action: Action): GameState {
  if (!isLegalAction(state, action)) {
    throw new Error(`Illegal action ${actionKey(action)} at ply ${state.ply}`);
  }
  return applyActionUnchecked(state, action);
}

/**
 * Applies an action without legality checks (caller guarantees legality).
 * `draw` takes the top (last element) of the mover's pool.
 */
export function applyActionUnchecked(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'draw': {
      const pool = state.pools[state.toMove];
      return drawRank(state, pool[pool.length - 1]);
    }
    case 'place':
      return place(state, action.to, action.faceUp, action);
    case 'flip':
      return flip(state, action.at, action);
    case 'move':
      return move(state, action.from, action.to, action);
  }
}

const DRAW_ACTION: Action = { type: 'draw' };

/**
 * Draw a specific rank from the mover's pool (removes one instance). Used by
 * search code to model draws as chance events independent of pool order.
 */
export function drawRank(state: GameState, rank: Rank): GameState {
  const side = state.toMove;
  const pool = state.pools[side];
  const idx = pool.lastIndexOf(rank);
  if (idx < 0 || state.pending !== null) throw new Error('drawRank: cannot draw');
  const np = pool.slice();
  np.splice(idx, 1);
  const piece: Piece = { side, rank };
  return {
    ...state,
    pools: side === 'red' ? { red: np, black: state.pools.black } : { red: state.pools.red, black: np },
    pending: piece,
    ply: state.ply + 1,
    lastAction: { side, action: DRAW_ACTION, piece, captured: null, captureKind: null },
  };
}

function place(state: GameState, to: Square, faceUp: boolean, action: Action): GameState {
  const p = state.pending!;
  const board = state.board.slice();
  board[to] = { side: p.side, rank: p.rank, faceUp };
  return finish(state, board, state.pools, state.captured, true, {
    side: p.side,
    action,
    piece: p,
    captured: null,
    captureKind: null,
  });
}

function flip(state: GameState, at: Square, action: Action): GameState {
  const c = state.board[at]!;
  const board = state.board.slice();
  const up: BoardPiece = { side: c.side, rank: c.rank, faceUp: true };
  board[at] = up;
  return finish(state, board, state.pools, state.captured, true, {
    side: state.toMove,
    action,
    piece: { side: c.side, rank: c.rank },
    captured: null,
    captureKind: null,
  });
}

function move(state: GameState, from: Square, to: Square, action: Action): GameState {
  const p = state.board[from]!;
  const target = state.board[to];
  const board = state.board.slice();
  board[to] = p;
  board[from] = null;
  let captured = state.captured;
  let kind: CaptureKind | null = null;
  if (target !== null) {
    const list = captured[target.side].concat(target.rank);
    captured = target.side === 'red' ? { red: list, black: captured.black } : { red: captured.red, black: list };
    if (p.rank === CANNON) kind = 'cannon';
    else if (p.rank === CHARIOT && !RAYS[from].some((r) => r[0] === to)) kind = 'charge';
    else kind = 'step';
  }
  return finish(state, board, state.pools, captured, target !== null, {
    side: state.toMove,
    action,
    piece: { side: p.side, rank: p.rank },
    captured: target === null ? null : { side: target.side, rank: target.rank },
    captureKind: kind,
  });
}

function finish(
  prev: GameState,
  board: Cell[],
  pools: GameState['pools'],
  captured: GameState['captured'],
  irreversible: boolean,
  record: ActionRecord,
): GameState {
  const next: GameState = {
    board,
    pools,
    captured,
    toMove: other(prev.toMove),
    pending: null,
    ply: prev.ply + 1,
    rules: prev.rules,
    rep: null,
    result: null,
    lastAction: record,
  };
  const key = positionKey(next);
  const rep: RepNode = { key, prev: irreversible ? null : prev.rep };
  let result: GameResult | null = null;
  if (!irreversible) {
    let count = 0;
    for (let n: RepNode | null = rep; n !== null; n = n.prev) if (n.key === key) count++;
    if (count >= 3) result = { winner: null, reason: 'repetition' };
  }
  const out: GameState = { ...next, rep };
  if (result === null && !hasAnyLegalAction(out)) {
    result = { winner: prev.toMove, reason: 'no-legal-actions' };
  }
  return result === null ? out : { ...out, result };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function countOnBoard(state: GameState, side: Side): number {
  let n = 0;
  for (const c of state.board) if (c !== null && c.side === side) n++;
  return n;
}

export function emptySquares(state: GameState): Square[] {
  const out: Square[] = [];
  state.board.forEach((c, i) => {
    if (c === null) out.push(i);
  });
  return out;
}
