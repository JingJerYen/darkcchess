import { PIECE_NAMES, SIDE_NAMES, colOf, other, rowOf } from '../engine';
import type { ActionRecord, GameResult, Piece, Square } from '../engine';

const ROW_LABELS = ['A', 'B', 'C', 'D'];

export function squareName(s: Square): string {
  return `${ROW_LABELS[rowOf(s)]}${colOf(s) + 1}`;
}

export function pieceName(p: Piece): string {
  return PIECE_NAMES[p.side][p.rank];
}

/**
 * Human-readable text for the last action. Never reveals the rank of a drawn
 * piece or of a piece placed face-down.
 */
export function describeAction(rec: ActionRecord): string {
  const who = SIDE_NAMES[rec.side];
  const a = rec.action;
  switch (a.type) {
    case 'draw':
      return `${who}抽了一顆棋`;
    case 'place':
      return a.faceUp
        ? `${who}在 ${squareName(a.to)} 放下明棋「${pieceName(rec.piece!)}」`
        : `${who}在 ${squareName(a.to)} 放下一顆暗棋`;
    case 'flip': {
      const p = rec.piece!;
      const owner = p.side === rec.side ? '自己' : SIDE_NAMES[p.side];
      return `${who}翻開${owner}在 ${squareName(a.at)} 的暗棋：「${pieceName(p)}」`;
    }
    case 'move': {
      const mover = pieceName(rec.piece!);
      if (rec.captured === null) return `${who}的「${mover}」從 ${squareName(a.from)} 走到 ${squareName(a.to)}`;
      const victim = pieceName(rec.captured);
      if (rec.captureKind === 'cannon') return `${who}的「${mover}」隔子打掉「${victim}」（${squareName(a.to)}）`;
      if (rec.captureKind === 'charge') return `${who}的「${mover}」直衝吃掉「${victim}」（${squareName(a.to)}）`;
      return `${who}的「${mover}」吃掉「${victim}」（${squareName(a.to)}）`;
    }
  }
}

export function describeResult(r: GameResult, loserHint?: string): string {
  if (r.reason === 'repetition') return '同一局面第三次出現，和局';
  const winner = r.winner!;
  return `${SIDE_NAMES[other(winner)]}${loserHint ?? ''}沒有任何合法動作，${SIDE_NAMES[winner]}獲勝！`;
}
