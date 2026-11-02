/** Headless game runner shared by the arena and tests. No DOM, no Node APIs. */
import { actionKey, applyAction, createRng, newGame, observationFor, other } from '../engine';
import type { Action, GameState, Observation, Rank, RulesConfig, Side } from '../engine';
import type { Bot } from '../bot/types';

export const DUMP_SCHEMA_VERSION = 1;

export interface CaptureEvent {
  ply: number;
  attackerSide: Side;
  attacker: Rank;
  victim: Rank;
  kind: 'step' | 'cannon' | 'charge';
}

export interface DumpRecord {
  v: number;
  game: number;
  ply: number;
  side: Side;
  bot: string;
  x: ReturnType<typeof obsFeatures>;
  action: string;
  /** Final result from `side`'s perspective: 1 win, 0.5 draw, 0 loss. */
  result: number;
}

export interface GameRecord {
  index: number;
  seed: number;
  winner: Side | null;
  reason: 'no-legal-actions' | 'repetition' | 'ply-limit';
  plies: number;
  durationMs: number;
  thinkMs: { red: number; black: number };
  decisions: { red: number; black: number };
  captures: CaptureEvent[];
  dump?: DumpRecord[];
}

/** Compact, viewer-relative feature encoding of an observation (dump schema v1). */
export function obsFeatures(obs: Observation) {
  const me = obs.viewer;
  const opp = other(me);
  // +rank own face-up, +(8+rank) own face-down, -rank opponent face-up, -8 opponent face-down, 0 empty
  const board = obs.board.map((c) => {
    if (c === null) return 0;
    if (c.side === me) return c.faceUp ? c.rank! : 8 + c.rank!;
    return c.faceUp ? -c.rank! : -8;
  });
  const perRank = (ranks: readonly Rank[]) => {
    const out = [0, 0, 0, 0, 0, 0, 0];
    for (const r of ranks) out[r - 1]++;
    return out;
  };
  return {
    board,
    myPool: perRank(obs.myPool),
    oppPoolCount: obs.poolCounts[opp],
    myCaptured: perRank(obs.captured[me]),
    oppCaptured: perRank(obs.captured[opp]),
    pending: obs.pending?.rank ?? 0,
    ply: obs.ply,
    repLen: obs.repHistory.length,
    rules: obs.rules.chariotChargeCapturesAny ? 1 : 0,
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function playGame(opts: {
  index: number;
  seed: number;
  red: Bot;
  black: Bot;
  botSeeds: { red: number; black: number };
  rules?: Partial<RulesConfig>;
  maxPlies?: number;
  dump?: boolean;
}): Promise<GameRecord> {
  const t0 = now();
  let s: GameState = newGame(opts.seed, opts.rules);
  const bots = { red: opts.red, black: opts.black };
  const rngs = { red: createRng(opts.botSeeds.red), black: createRng(opts.botSeeds.black) };
  const thinkMs = { red: 0, black: 0 };
  const decisions = { red: 0, black: 0 };
  const captures: CaptureEvent[] = [];
  const dump: Omit<DumpRecord, 'result'>[] = [];
  const maxPlies = opts.maxPlies ?? 1000;
  while (s.result === null && s.ply < maxPlies) {
    const side = s.toMove;
    const obs = observationFor(s, side);
    const t = now();
    const a: Action = await bots[side].chooseAction(obs, rngs[side]);
    thinkMs[side] += now() - t;
    decisions[side]++;
    if (opts.dump) {
      dump.push({ v: DUMP_SCHEMA_VERSION, game: opts.index, ply: s.ply, side, bot: bots[side].name, x: obsFeatures(obs), action: actionKey(a) });
    }
    s = applyAction(s, a);
    const la = s.lastAction!;
    if (la.captured) {
      captures.push({ ply: s.ply, attackerSide: la.side, attacker: la.piece!.rank, victim: la.captured.rank, kind: la.captureKind! });
    }
  }
  const winner = s.result?.winner ?? null;
  const rec: GameRecord = {
    index: opts.index,
    seed: opts.seed,
    winner,
    reason: s.result?.reason ?? 'ply-limit',
    plies: s.ply,
    durationMs: now() - t0,
    thinkMs,
    decisions,
    captures,
  };
  if (opts.dump) {
    rec.dump = dump.map((d) => ({ ...d, result: winner === null ? 0.5 : winner === d.side ? 1 : 0 }));
  }
  return rec;
}
