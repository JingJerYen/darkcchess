export type Side = 'red' | 'black';

/** 7 = King (帥/將) … 1 = Pawn (兵/卒). Higher is stronger. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Piece {
  readonly side: Side;
  readonly rank: Rank;
}

export interface BoardPiece extends Piece {
  readonly faceUp: boolean;
}

export type Cell = BoardPiece | null;

/** Square index = row * 8 + col, row 0..3, col 0..7. */
export type Square = number;

export type Action =
  | { readonly type: 'draw' }
  | { readonly type: 'place'; readonly to: Square; readonly faceUp: boolean }
  | { readonly type: 'flip'; readonly at: Square }
  | { readonly type: 'move'; readonly from: Square; readonly to: Square };

export interface RulesConfig {
  /** When true a chariot charge (distance >= 2) may capture any face-up enemy. */
  readonly chariotChargeCapturesAny: boolean;
}

export type CaptureKind = 'step' | 'cannon' | 'charge';

/**
 * Full record of the last action. NOTE: `piece` of a `draw` and of a face-down
 * `place` is private information — UI/loggers must not reveal it.
 */
export interface ActionRecord {
  readonly side: Side;
  readonly action: Action;
  /** draw/place: the piece; flip: the revealed piece; move: the mover. */
  readonly piece: Piece | null;
  readonly captured: Piece | null;
  readonly captureKind: CaptureKind | null;
}

export type ResultReason = 'no-legal-actions' | 'repetition';

export interface GameResult {
  /** null = draw. */
  readonly winner: Side | null;
  readonly reason: ResultReason;
}

/** Immutable linked list of position keys since the last irreversible action. */
export interface RepNode {
  readonly key: string;
  readonly prev: RepNode | null;
}

export interface GameState {
  readonly board: readonly Cell[];
  /** Remaining pool ranks for each side; the next draw takes the last element. */
  readonly pools: { readonly red: readonly Rank[]; readonly black: readonly Rank[] };
  /** Ranks of each side's pieces that have been captured (in capture order). */
  readonly captured: { readonly red: readonly Rank[]; readonly black: readonly Rank[] };
  readonly toMove: Side;
  /** Drawn piece that must be placed next (only the drawer may see it). */
  readonly pending: Piece | null;
  /** Number of actions applied so far (draw and place count separately). */
  readonly ply: number;
  readonly rules: RulesConfig;
  readonly rep: RepNode | null;
  readonly result: GameResult | null;
  readonly lastAction: ActionRecord | null;
}
