import { describe, expect, it } from 'vitest';
import {
  actionKey,
  applyAction,
  createRng,
  isLegalAction,
  legalActions,
  newGame,
  observationFor,
  other,
} from '../src/engine';
import type { GameState, Rank } from '../src/engine';
import {
  GreedyBot,
  MctsBot,
  PRESETS,
  RandomBot,
  determinize,
  legalActionsFromObs,
  rollout,
  sampleRank,
  unknownOpponentRanks,
} from '../src/bot';
import type { MctsParams } from '../src/bot';
import { completeWithCaptured, mk } from './helpers';

const TINY: MctsParams = { ...PRESETS.easy, determinizations: 2, iterations: 30, timeBudgetMs: 60_000 };

/** Random position reached by `n` uniformly random actions from a seeded deal. */
function randomPosition(seed: number, n: number): GameState {
  const rng = createRng(seed);
  let s = newGame(seed);
  for (let i = 0; i < n && s.result === null; i++) {
    const acts = legalActions(s);
    s = applyAction(s, acts[rng.int(acts.length)]);
  }
  return s;
}

/** Permute the opponent's unknown pieces (hidden ranks + pool) of `viewer`. */
function scrambleOpponent(s: GameState, viewer: 'red' | 'black', seed: number): GameState {
  const opp = other(viewer);
  const hiddenSq: number[] = [];
  s.board.forEach((c, i) => {
    if (c !== null && c.side === opp && !c.faceUp) hiddenSq.push(i);
  });
  const U: Rank[] = [...hiddenSq.map((i) => s.board[i]!.rank), ...s.pools[opp]];
  const rng = createRng(seed);
  for (let i = U.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [U[i], U[j]] = [U[j], U[i]];
  }
  const board = s.board.slice();
  hiddenSq.forEach((sq, k) => (board[sq] = { ...board[sq]!, rank: U[k] }));
  const pool = U.slice(hiddenSq.length);
  return { ...s, board, pools: opp === 'red' ? { red: pool, black: s.pools.black } : { red: s.pools.red, black: pool } };
}

/** Find a position (to move: viewer) where the opponent has several hidden pieces and a pool. */
function richPosition(seed: number): GameState {
  for (let n = 20; ; n++) {
    const s = randomPosition(seed, n);
    if (s.result !== null) return randomPosition(seed + 1000, 20);
    const opp = other(s.toMove);
    const hidden = s.board.filter((c) => c && c.side === opp && !c.faceUp).length;
    if (s.pending === null && hidden >= 2 && s.pools[opp].length >= 2) return s;
  }
}

describe('observation firewall', () => {
  it('states differing only in opponent hidden ranks / pool order give identical observations and bot actions', async () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s1 = richPosition(seed);
      const me = s1.toMove;
      let s2 = scrambleOpponent(s1, me, seed * 31);
      if (JSON.stringify(s2.board) === JSON.stringify(s1.board)) s2 = scrambleOpponent(s1, me, seed * 31 + 1);
      expect(JSON.stringify(s2)).not.toBe(JSON.stringify(s1));
      const o1 = observationFor(s1, me);
      const o2 = observationFor(s2, me);
      expect(o2).toEqual(o1);
      const bot = new MctsBot(TINY);
      const a1 = await bot.chooseAction(o1, createRng(99));
      const a2 = await bot.chooseAction(o2, createRng(99));
      expect(actionKey(a2)).toBe(actionKey(a1));
    }
  });

  it('observation exposes own hidden ranks, own pool composition, pending draw', () => {
    let s = newGame(11);
    s = applyAction(s, { type: 'draw' });
    const o = observationFor(s, 'red');
    expect(o.pending).toEqual(s.pending);
    expect(o.myPool.length).toBe(15);
    s = applyAction(s, { type: 'place', to: 9, faceUp: false });
    expect(observationFor(s, 'red').board[9]!.rank).toBe(s.board[9]!.rank);
    expect(observationFor(s, 'black').board[9]!.rank).toBeNull();
  });
});

describe('determinization', () => {
  it('satisfies |U| = hidden + pool and is consistent with the observation', () => {
    for (let seed = 0; seed < 60; seed++) {
      const s = randomPosition(seed, (seed * 13) % 120);
      if (s.result !== null) continue;
      for (const viewer of ['red', 'black'] as const) {
        const obs = observationFor(s, viewer);
        const opp = other(viewer);
        const U = unknownOpponentRanks(obs);
        expect(U.length).toBe(obs.hiddenCounts[opp] + obs.poolCounts[opp] + (obs.opponentPending ? 1 : 0));
        for (let k = 0; k < 3; k++) {
          const d = determinize(obs, createRng(seed * 10 + k));
          expect(observationFor(d, viewer)).toEqual(obs);
          // multiset of opponent pieces is the full set of 16 minus captured
          const all = [
            ...d.board.filter((c) => c && c.side === opp).map((c) => c!.rank),
            ...d.pools[opp],
            ...d.captured[opp],
            ...(d.pending && d.pending.side === opp ? [d.pending.rank] : []),
          ].sort();
          expect(all).toEqual([7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 1].sort());
          // legal actions identical to the real state's
          expect(legalActions(d).map(actionKey).sort()).toEqual(legalActions(s).map(actionKey).sort());
        }
      }
    }
  });

  it('asserts when the observation is inconsistent', () => {
    const obs = observationFor(newGame(1), 'red');
    const bad = { ...obs, poolCounts: { red: 16, black: 15 } };
    expect(() => determinize(bad, createRng(1))).toThrow(/\|U\|/);
  });
});

describe('chance nodes', () => {
  it('sampleRank depends only on the pool multiset', () => {
    const a: Rank[] = [7, 1, 1, 3, 2, 1];
    const b: Rank[] = [1, 2, 1, 7, 1, 3];
    for (let seed = 0; seed < 50; seed++) {
      expect(sampleRank(a, createRng(seed))).toBe(sampleRank(b, createRng(seed)));
    }
  });
  it('sampleRank follows the composition', () => {
    const rng = createRng(3);
    let ones = 0;
    for (let i = 0; i < 4000; i++) if (sampleRank([1, 1, 1, 7], rng) === 1) ones++;
    expect(ones / 4000).toBeGreaterThan(0.71);
    expect(ones / 4000).toBeLessThan(0.79);
  });
  it('rollouts do not depend on the pre-arranged pool order', () => {
    for (let seed = 0; seed < 10; seed++) {
      const s = randomPosition(seed, 6);
      const rev: GameState = { ...s, pools: { red: [...s.pools.red].reverse(), black: [...s.pools.black].reverse() } };
      expect(rollout(rev, createRng(seed), 40)).toBeCloseTo(rollout(s, createRng(seed), 40), 12);
    }
  });
  it('search result does not depend on own pool order (same obs)', async () => {
    const s = newGame(21);
    const t: GameState = { ...s, pools: { red: [...s.pools.red].reverse(), black: s.pools.black } };
    const bot = new MctsBot(TINY);
    const a = await bot.chooseAction(observationFor(s, 'red'), createRng(5));
    const b = await bot.chooseAction(observationFor(t, 'red'), createRng(5));
    expect(actionKey(a)).toBe(actionKey(b));
  });
});

describe('bots always return legal actions', () => {
  it('random / greedy / mcts on 200 random positions', async () => {
    const bots = [new RandomBot(), new GreedyBot(), new MctsBot(TINY)];
    let checked = 0;
    for (let seed = 0; checked < 200; seed++) {
      const s = randomPosition(seed, (seed * 37) % 200);
      if (s.result !== null) continue;
      const obs = observationFor(s, s.toMove);
      expect(legalActionsFromObs(obs).map(actionKey).sort()).toEqual(legalActions(s).map(actionKey).sort());
      for (const bot of bots) {
        const a = await bot.chooseAction(obs, createRng(seed));
        expect(isLegalAction(s, a), `${bot.name} at seed ${seed}`).toBe(true);
      }
      checked++;
    }
  });
  it('greedy takes the biggest capture', async () => {
    // Red: pawn next to black king, horse next to black pawn. Missing pieces count as captured.
    const st = completeWithCaptured(mk(['Pk......', '........', '......Np', '........']));
    const a = await new GreedyBot().chooseAction(observationFor(st, 'red'), createRng(1));
    expect(actionKey(a)).toBe('m0-1');
  });
});
