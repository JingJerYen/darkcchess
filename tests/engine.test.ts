import { describe, expect, it } from 'vitest';
import {
  PIECE_SET,
  actionKey,
  applyAction,
  canCapture,
  isLegalAction,
  legalActions,
  newGame,
  observationFor,
  positionKey,
  sq,
} from '../src/engine';
import type { Action, GameState } from '../src/engine';
import { mk, mv } from './helpers';

const keys = (s: GameState) => new Set(legalActions(s).map(actionKey));
const legal = (s: GameState, a: Action) => keys(s).has(actionKey(a));

describe('rank rule canCapture', () => {
  it('pawn captures king', () => expect(canCapture(1, 7)).toBe(true));
  it('king cannot capture pawn', () => expect(canCapture(7, 1)).toBe(false));
  it('pawn cannot capture cannon', () => expect(canCapture(1, 2)).toBe(false));
  it('horse captures cannon', () => expect(canCapture(3, 2)).toBe(true));
  it('same rank captures', () => {
    for (const r of [1, 3, 4, 5, 6, 7] as const) expect(canCapture(r, r)).toBe(true);
  });
  it('advisor cannot capture king', () => expect(canCapture(6, 7)).toBe(false));
  it('king captures king', () => expect(canCapture(7, 7)).toBe(true));
  it('cannon never captures by rank rule', () => expect(canCapture(2, 1)).toBe(false));

  it('applies on the board: pawn takes adjacent king, king cannot take pawn', () => {
    const s = mk(['Pk......', 'p.......', 'K.......', '........']);
    expect(legal(s, mv(sq(0, 0), sq(0, 1)))).toBe(true); // P x k
    const t = mk(['Pk......', '........', '........', '........'], { toMove: 'black' });
    expect(legal(t, mv(sq(0, 1), sq(0, 0)))).toBe(false); // k x P
  });
});

describe('cannon', () => {
  it('jumps over a face-down screen', () => {
    const s = mk(['C.x.r...', '........', '........', '........']);
    expect(legal(s, mv(0, 4))).toBe(true);
  });
  it('jumps over an own screen', () => {
    const s = mk(['C.P..r..', '........', '........', '........']);
    expect(legal(s, mv(0, 5))).toBe(true);
  });
  it('jumps over an enemy screen', () => {
    const s = mk(['Cp.k....', '........', '........', '........']);
    expect(legal(s, mv(0, 3))).toBe(true);
  });
  it('vertical jump works too', () => {
    const s = mk(['C.......', 'x.......', '........', 'a.......']);
    expect(legal(s, mv(sq(0, 0), sq(3, 0)))).toBe(true);
  });
  it('cannot jump two pieces', () => {
    const s = mk(['CxX.r...', '........', '........', '........']);
    expect(legal(s, mv(0, 4))).toBe(false);
  });
  it('cannot capture adjacent', () => {
    const s = mk(['Cp......', '........', '........', '........']);
    expect(legal(s, mv(0, 1))).toBe(false);
  });
  it('cannot capture a face-down piece behind the screen', () => {
    const s = mk(['C.P.x...', '........', '........', '........']);
    expect(legal(s, mv(0, 4))).toBe(false);
  });
  it('can capture the king', () => {
    const s = mk(['CPk.....', '........', '........', '........']);
    expect(legal(s, mv(0, 2))).toBe(true);
  });
  it('cannot capture own piece', () => {
    const s = mk(['CpP.....', '........', '........', '........']);
    expect(legal(s, mv(0, 2))).toBe(false);
  });
  it('only the first piece after the screen counts', () => {
    const s = mk(['CpP.k...', '........', '........', '........']);
    expect(legal(s, mv(0, 4))).toBe(false);
  });
  it('still steps one square onto empty squares', () => {
    const s = mk(['........', '...C....', '........', '........']);
    expect(keys(s)).toEqual(new Set(['m11-3', 'm11-19', 'm11-10', 'm11-12']));
  });
});

describe('chariot charge', () => {
  it('captures along an empty path', () => {
    const s = mk(['R....n..', '........', '........', '........']);
    expect(legal(s, mv(0, 5))).toBe(true);
  });
  it('is blocked by a face-down piece', () => {
    const s = mk(['R..x.n..', '........', '........', '........']);
    expect(legal(s, mv(0, 5))).toBe(false);
  });
  it('is blocked by an own piece', () => {
    const s = mk(['R..P.n..', '........', '........', '........']);
    expect(legal(s, mv(0, 5))).toBe(false);
  });
  it('cannot charge-capture elephant / advisor / king when flag is false', () => {
    for (const ch of ['b', 'a', 'k']) {
      const s = mk([`R....${ch}..`, '........', '........', '........']);
      expect(legal(s, mv(0, 5))).toBe(false);
    }
  });
  it('can charge-capture anything when the flag is true', () => {
    for (const ch of ['b', 'a', 'k']) {
      const s = mk([`R....${ch}..`, '........', '........', '........'], { rules: { chariotChargeCapturesAny: true } });
      expect(legal(s, mv(0, 5))).toBe(true);
    }
  });
  it('flag does not affect distance-1 captures', () => {
    const s = mk(['Rk......', '........', '........', '........'], { rules: { chariotChargeCapturesAny: true } });
    expect(legal(s, mv(0, 1))).toBe(false);
  });
  it('captures cannon/pawn/horse/chariot by charge', () => {
    for (const ch of ['c', 'p', 'n', 'r']) {
      const s = mk(['R.......', '........', '........', `${ch}.......`]);
      expect(legal(s, mv(sq(0, 0), sq(3, 0)))).toBe(true);
    }
  });
  it('lands on the captured square', () => {
    const s = mk(['R....n..', '........', '........', '.......p'], { toMove: 'red' });
    const t = applyAction(s, mv(0, 5));
    expect(t.board[0]).toBeNull();
    expect(t.board[5]).toEqual({ side: 'red', rank: 4, faceUp: true });
    expect(t.captured.black).toEqual([3]);
    expect(t.lastAction?.captureKind).toBe('charge');
  });
  it('normal non-capturing movement is still one square', () => {
    const s = mk(['R.......', '........', '........', '........']);
    expect(keys(s)).toEqual(new Set(['m0-1', 'm0-8']));
  });
});

describe('face-down pieces', () => {
  it('cannot be captured', () => {
    const s = mk(['Kx......', '........', '........', '........']);
    expect(legal(s, mv(0, 1))).toBe(false);
  });
  it('cannot move', () => {
    const s = mk(['X.......', '........', '........', '........']);
    expect([...keys(s)]).toEqual(['f0']);
  });
  it('act as cannon screens (covered above) and block charges (covered above)', () => {
    const s = mk(['C.X.k...', '........', '........', '........']);
    expect(legal(s, mv(0, 4))).toBe(true);
  });
});

describe('drawing', () => {
  it('cannot draw from an empty pool', () => {
    const s = mk(['K.......', '........', '........', '........']);
    expect(legal(s, { type: 'draw' })).toBe(false);
  });
  it('cannot draw when the board is full', () => {
    const full = 'XXXXXXXX';
    const s = mk([full, full, full, full], { pools: { red: [1], black: [1] } });
    expect(legal(s, { type: 'draw' })).toBe(false);
    expect(legalActions(s).every((a) => a.type === 'flip')).toBe(true);
  });
  it('after drawing only placements are legal', () => {
    const g = newGame(1);
    const t = applyAction(g, { type: 'draw' });
    expect(t.pending).not.toBeNull();
    expect(t.toMove).toBe('red');
    const acts = legalActions(t);
    expect(acts.length).toBe(64);
    expect(acts.every((a) => a.type === 'place')).toBe(true);
    expect(() => applyAction(t, { type: 'draw' })).toThrow();
    const u = applyAction(t, { type: 'place', to: 5, faceUp: false });
    expect(u.board[5]).toEqual({ side: 'red', rank: t.pending!.rank, faceUp: false });
    expect(u.toMove).toBe('black');
    expect(u.pools.red.length).toBe(15);
  });
  it('only draws own colour', () => {
    let s = newGame(3);
    s = applyAction(s, { type: 'draw' });
    expect(s.pending!.side).toBe('red');
    s = applyAction(s, { type: 'place', to: 0, faceUp: true });
    s = applyAction(s, { type: 'draw' });
    expect(s.pending!.side).toBe('black');
  });
});

describe('flipping', () => {
  it("can flip the opponent's piece, which stays theirs", () => {
    const s = mk(['x.......', '........', '........', '.......K'], { hidden: { 0: 3 } });
    expect(legal(s, { type: 'flip', at: 0 })).toBe(true);
    const t = applyAction(s, { type: 'flip', at: 0 });
    expect(t.board[0]).toEqual({ side: 'black', rank: 3, faceUp: true });
    expect(t.toMove).toBe('black');
  });
});

describe('game end', () => {
  it('a side with no legal action loses', () => {
    // Black's only piece is a pawn boxed in; after red's move black has nothing.
    const s = mk(['pR......', 'K.......', '........', '........'], { toMove: 'red' });
    // red king at (1,0) cannot take the pawn; red moves the chariot away to (0,2)?
    // Instead: red chariot steps down, black pawn can still move -> not over.
    const t = applyAction(s, mv(1, 2));
    expect(t.result).toBeNull();
    // Box: black pawn at corner, surrounded by red pieces it cannot capture.
    const u = mk(['pA......', 'B.......', '.......R', '........'], { toMove: 'red' });
    const v = applyAction(u, mv(sq(2, 7), sq(3, 7)));
    expect(v.result).toEqual({ winner: 'red', reason: 'no-legal-actions' });
    expect(legalActions(v)).toEqual([]);
  });
  it('losing by having no pieces at all', () => {
    const s = mk(['Rn......', '........', '........', '........']);
    const t = applyAction(s, mv(0, 1));
    expect(t.result).toEqual({ winner: 'red', reason: 'no-legal-actions' });
  });
  it('third repetition is a draw', () => {
    let s = mk(['R.......', '........', '........', '.......r']);
    const cycle: Action[] = [mv(0, 1), mv(31, 30), mv(1, 0), mv(30, 31)];
    s = applyAction(s, cycle[0]);
    s = applyAction(s, cycle[1]);
    s = applyAction(s, cycle[2]);
    s = applyAction(s, cycle[3]); // initial position, 2nd occurrence
    expect(s.result).toBeNull();
    for (const a of cycle.slice(0, 3)) s = applyAction(s, a);
    expect(s.result).toBeNull();
    s = applyAction(s, cycle[3]); // 3rd occurrence
    expect(s.result).toEqual({ winner: null, reason: 'repetition' });
  });
  it('position key includes pools and side to move', () => {
    const a = mk(['R.......', '........', '........', '........'], { pools: { red: [1] } });
    const b = mk(['R.......', '........', '........', '........'], { pools: { red: [] } });
    const c = mk(['R.......', '........', '........', '........'], { pools: { red: [1] }, toMove: 'black' });
    expect(new Set([positionKey(a), positionKey(b), positionKey(c)]).size).toBe(3);
  });
});

describe('immutability, seeds, hidden information', () => {
  it('applyAction does not mutate its input', () => {
    const g = newGame(7);
    const snap = JSON.stringify(g);
    applyAction(applyAction(g, { type: 'draw' }), { type: 'place', to: 3, faceUp: true });
    expect(JSON.stringify(g)).toBe(snap);
  });
  it('same seed gives the same deal, different seeds differ', () => {
    expect(newGame(42).pools).toEqual(newGame(42).pools);
    expect(newGame(42).pools).not.toEqual(newGame(43).pools);
    expect([...newGame(42).pools.red].sort()).toEqual([...PIECE_SET].sort());
  });
  it('observation hides opponent hidden ranks and pool order', () => {
    let s = newGame(5);
    s = applyAction(s, { type: 'draw' });
    s = applyAction(s, { type: 'place', to: 0, faceUp: false });
    const ob = observationFor(s, 'black');
    expect(ob.board[0]).toEqual({ side: 'red', faceUp: false, rank: null });
    expect(ob).not.toHaveProperty('pools');
    const or = observationFor(s, 'red');
    expect(or.board[0]!.rank).toBe(s.board[0]!.rank);
    expect(or.myPool).toEqual([...s.pools.red].sort((a, b) => a - b));
    // Swap opponent hidden rank with a different one in their pool -> identical obs for black.
    const other = s.pools.red.find((r) => r !== s.board[0]!.rank)!;
    const swappedPool = s.pools.red.slice();
    swappedPool[swappedPool.indexOf(other)] = s.board[0]!.rank;
    swappedPool.reverse();
    const s2: GameState = {
      ...s,
      board: s.board.map((c, i) => (i === 0 ? { ...c!, rank: other } : c)),
      pools: { red: swappedPool, black: s.pools.black },
    };
    expect(observationFor(s2, 'black')).toEqual(ob);
    expect(observationFor(s2, 'red')).not.toEqual(or);
  });
  it('pending piece is only visible to the drawer', () => {
    const s = applyAction(newGame(9), { type: 'draw' });
    expect(observationFor(s, 'red').pending).toEqual(s.pending);
    expect(observationFor(s, 'black').pending).toBeNull();
    expect(observationFor(s, 'black').opponentPending).toBe(true);
  });
  it('random playouts always stay legal and terminate cleanly', () => {
    for (let g = 0; g < 30; g++) {
      let s = newGame(g);
      let n = 0;
      let x = g * 7 + 1;
      while (s.result === null && n < 3000) {
        const acts = legalActions(s);
        expect(acts.length).toBeGreaterThan(0);
        x = (x * 1103515245 + 12345) % 2147483648;
        const a = acts[x % acts.length];
        expect(isLegalAction(s, a)).toBe(true);
        s = applyAction(s, a);
        n++;
      }
      if (s.result) expect(legalActions(s)).toEqual([]);
    }
  });
});
