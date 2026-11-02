/**
 * Headless self-play arena.
 *
 *   npm run arena -- --games 1000 --red mcts:normal --black random --seed 1 \
 *     --out result.json [--chariot-any] [--dump data.jsonl] [--workers 4] [--max-plies 1000]
 *
 * Bot specs: random | greedy | mcts:easy | mcts:normal | mcts:hard, optionally
 * with overrides, e.g. mcts:normal,t=200,d=4,i=100,c=0.7,r=30.
 * Colours are swapped every other game, so each bot plays red in half the games.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { createWriteStream, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GreedyBot, MctsBot, PRESETS, RandomBot } from '../src/bot';
import type { Bot, Difficulty, MctsParams } from '../src/bot';
import { PIECE_NAMES } from '../src/engine';
import type { Rank } from '../src/engine';
import { playGame } from '../src/sim/playGame';
import type { GameRecord } from '../src/sim/playGame';

interface Args {
  games: number;
  red: string;
  black: string;
  seed: number;
  out: string | null;
  chariotAny: boolean;
  dump: string | null;
  workers: number;
  maxPlies: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    games: 100,
    red: 'mcts:normal',
    black: 'random',
    seed: 1,
    out: null,
    chariotAny: false,
    dump: null,
    workers: Math.max(1, availableParallelism()),
    maxPlies: 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`missing value for ${k}`);
      return x;
    };
    switch (k) {
      case '--games': a.games = parseInt(v(), 10); break;
      case '--red': a.red = v(); break;
      case '--black': a.black = v(); break;
      case '--seed': a.seed = parseInt(v(), 10); break;
      case '--out': a.out = v(); break;
      case '--chariot-any': a.chariotAny = true; break;
      case '--dump': a.dump = v(); break;
      case '--workers': a.workers = Math.max(1, parseInt(v(), 10)); break;
      case '--max-plies': a.maxPlies = parseInt(v(), 10); break;
      case '-h':
      case '--help':
        console.log('usage: npm run arena -- --games N --red SPEC --black SPEC [--seed S] [--out f.json] [--chariot-any] [--dump f.jsonl] [--workers N] [--max-plies N]');
        process.exit(0);
      default:
        throw new Error(`unknown argument ${k}`);
    }
  }
  return a;
}

export function makeBot(spec: string): Bot {
  const [head, ...over] = spec.split(',');
  if (head === 'random') return new RandomBot();
  if (head === 'greedy') return new GreedyBot();
  const m = /^mcts:(easy|normal|hard)$/.exec(head);
  if (!m) throw new Error(`unknown bot spec ${spec}`);
  const p: MctsParams = { ...PRESETS[m[1] as Difficulty] };
  for (const o of over) {
    const [k, val] = o.split('=');
    const n = Number(val);
    if (k === 't') p.timeBudgetMs = n;
    else if (k === 'd') p.determinizations = n;
    else if (k === 'i') p.iterations = n;
    else if (k === 'c') p.uctC = n;
    else if (k === 'r') p.maxRolloutPlies = n;
    else if (k === 'pw') p.pwC = n;
    else throw new Error(`unknown override ${o}`);
  }
  return new MctsBot(p, spec);
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

interface Job {
  index: number;
}
interface WorkerInit {
  args: Args;
}

function gameSetup(args: Args, index: number) {
  const aIsRed = index % 2 === 0;
  // Paired games share the same deal (same seed) with colours swapped.
  const pair = Math.floor(index / 2);
  const seed = (args.seed * 1_000_003 + pair * 7919) >>> 0;
  return { aIsRed, seed, botSeeds: { red: (seed ^ 0x5bd1e995) >>> 0, black: (seed ^ 0x27d4eb2f) >>> 0 } };
}

async function workerMain(): Promise<void> {
  const { args } = workerData as WorkerInit;
  const botA = makeBot(args.red);
  const botB = makeBot(args.black);
  parentPort!.on('message', async (job: Job | null) => {
    if (job === null) {
      process.exit(0);
    }
    const g = gameSetup(args, job.index);
    const rec = await playGame({
      index: job.index,
      seed: g.seed,
      red: g.aIsRed ? botA : botB,
      black: g.aIsRed ? botB : botA,
      botSeeds: g.botSeeds,
      rules: { chariotChargeCapturesAny: args.chariotAny },
      maxPlies: args.maxPlies,
      dump: args.dump !== null,
    });
    parentPort!.postMessage({ rec, aIsRed: g.aIsRed });
  });
  parentPort!.postMessage('ready');
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const RANKS: Rank[] = [7, 6, 5, 4, 3, 2, 1];
const rname = (r: Rank) => `${PIECE_NAMES.red[r]}${PIECE_NAMES.black[r]}`;

interface WDL {
  win: number;
  draw: number;
  loss: number;
}
const wdl = (): WDL => ({ win: 0, draw: 0, loss: 0 });
const score = (x: WDL) => {
  const n = x.win + x.draw + x.loss;
  return n === 0 ? 0 : (x.win + 0.5 * x.draw) / n;
};
/** Display width (CJK = 2 columns). */
const width = (t: string) => [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const padE = (t: string, n: number) => t + ' '.repeat(Math.max(0, n - width(t)));
const padS = (t: string, n: number) => ' '.repeat(Math.max(0, n - width(t))) + t;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function summarize(args: Args, results: { rec: GameRecord; aIsRed: boolean }[]) {
  const A = wdl();
  const aRed = wdl();
  const aBlack = wdl();
  const redSide = wdl();
  const reasons: Record<string, number> = { 'no-legal-actions': 0, repetition: 0, 'ply-limit': 0 };
  let plies = 0;
  let ms = 0;
  const think = { a: 0, b: 0, aN: 0, bN: 0 };
  const capturesBy: Record<number, number> = {};
  const capturedCount: Record<number, number> = {};
  const capturedPlySum: Record<number, number> = {};
  const matrix: Record<number, Record<number, number>> = {};
  const kinds: Record<number, { step: number; cannon: number; charge: number }> = {};
  for (const r of RANKS) {
    capturesBy[r] = 0;
    capturedCount[r] = 0;
    capturedPlySum[r] = 0;
    matrix[r] = {};
    for (const v of RANKS) matrix[r][v] = 0;
    kinds[r] = { step: 0, cannon: 0, charge: 0 };
  }
  for (const { rec, aIsRed } of results) {
    const aSide = aIsRed ? 'red' : 'black';
    const bucket = aIsRed ? aRed : aBlack;
    if (rec.winner === null) {
      A.draw++;
      bucket.draw++;
      redSide.draw++;
    } else {
      if (rec.winner === aSide) {
        A.win++;
        bucket.win++;
      } else {
        A.loss++;
        bucket.loss++;
      }
      if (rec.winner === 'red') redSide.win++;
      else redSide.loss++;
    }
    reasons[rec.reason]++;
    plies += rec.plies;
    ms += rec.durationMs;
    const bSide = aIsRed ? 'black' : 'red';
    think.a += rec.thinkMs[aSide];
    think.aN += rec.decisions[aSide];
    think.b += rec.thinkMs[bSide];
    think.bN += rec.decisions[bSide];
    for (const c of rec.captures) {
      capturesBy[c.attacker]++;
      capturedCount[c.victim]++;
      capturedPlySum[c.victim] += c.ply;
      matrix[c.attacker][c.victim]++;
      kinds[c.attacker][c.kind]++;
    }
  }
  const n = results.length;
  const pieces = RANKS.map((r) => ({
    rank: r,
    name: rname(r),
    capturesPerGame: capturesBy[r] / n,
    capturedPerGame: capturedCount[r] / n,
    avgCapturedPly: capturedCount[r] ? capturedPlySum[r] / capturedCount[r] : null,
    captureKinds: kinds[r],
    victims: Object.fromEntries(RANKS.map((v) => [rname(v), matrix[r][v]])),
  }));
  return {
    config: { ...args },
    games: n,
    botA: args.red,
    botB: args.black,
    aResult: { ...A, score: score(A) },
    aAsRed: { ...aRed, score: score(aRed) },
    aAsBlack: { ...aBlack, score: score(aBlack) },
    redSide: { ...redSide, score: score(redSide) },
    drawReasons: { repetition: reasons.repetition, other: reasons['ply-limit'] },
    endReasons: reasons,
    avgPlies: plies / n,
    avgGameMs: ms / n,
    avgThinkMs: { a: think.aN ? think.a / think.aN : 0, b: think.bN ? think.b / think.bN : 0 },
    pieces,
  };
}

function printSummary(s: ReturnType<typeof summarize>) {
  const line = (label: string, x: WDL & { score: number }) =>
    `${label.padEnd(26)} W ${String(x.win).padStart(5)}  D ${String(x.draw).padStart(5)}  L ${String(x.loss).padStart(5)}  score ${pct(x.score)}`;
  console.log(`\n=== ${s.botA} (A) vs ${s.botB} (B), ${s.games} games${s.config.chariotAny ? ', chariot-any' : ''} ===`);
  console.log(line('A overall', s.aResult));
  console.log(line('A as red (first)', s.aAsRed));
  console.log(line('A as black', s.aAsBlack));
  console.log(line('Red side (first mover)', s.redSide));
  console.log(
    `Draws: repetition ${s.drawReasons.repetition}, other (ply limit) ${s.drawReasons.other}; avg plies ${s.avgPlies.toFixed(1)}; avg game ${(s.avgGameMs / 1000).toFixed(2)} s; think A ${s.avgThinkMs.a.toFixed(1)} ms/decision, B ${s.avgThinkMs.b.toFixed(1)} ms/decision`,
  );
  console.log('\nPiece   caps/game  lost/game  avg ply lost   step  cannon  charge');
  for (const p of s.pieces) {
    console.log(
      `${padE(p.name, 6)}${p.capturesPerGame.toFixed(2).padStart(10)}${p.capturedPerGame.toFixed(2).padStart(11)}${(p.avgCapturedPly === null ? '-' : p.avgCapturedPly.toFixed(1)).padStart(14)}${String(p.captureKinds.step).padStart(7)}${String(p.captureKinds.cannon).padStart(8)}${String(p.captureKinds.charge).padStart(8)}`,
    );
  }
  console.log('\nCaptured-by matrix (row = attacker, column = victim, totals):');
  console.log('      ' + s.pieces.map((p) => padS(p.name, 7)).join(''));
  for (const p of s.pieces) {
    console.log(padE(p.name, 6) + Object.values(p.victims).map((v) => String(v).padStart(7)).join(''));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  makeBot(args.red);
  makeBot(args.black);
  const workers = Math.min(args.workers, args.games);
  const results: { rec: GameRecord; aIsRed: boolean }[] = [];
  const dumpStream = args.dump ? createWriteStream(args.dump) : null;
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  await new Promise<void>((resolve, reject) => {
    for (let w = 0; w < workers; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { args } satisfies WorkerInit });
      const feed = () => {
        if (next < args.games) worker.postMessage({ index: next++ } satisfies Job);
        else worker.postMessage(null);
      };
      worker.on('message', (m: 'ready' | { rec: GameRecord; aIsRed: boolean }) => {
        if (m !== 'ready') {
          if (m.rec.dump && dumpStream) {
            for (const d of m.rec.dump) dumpStream.write(JSON.stringify(d) + '\n');
          }
          delete m.rec.dump;
          results.push(m);
          done++;
          if (done % Math.max(1, Math.floor(args.games / 20)) === 0 || done === args.games) {
            const el = (Date.now() - t0) / 1000;
            process.stderr.write(`  ${done}/${args.games} games, ${el.toFixed(0)} s elapsed\n`);
          }
          if (done === args.games) resolve();
        }
        feed();
      });
      worker.on('error', reject);
    }
  });
  dumpStream?.end();
  results.sort((a, b) => a.rec.index - b.rec.index);
  const summary = summarize(args, results);
  printSummary(summary);
  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ summary, games: results.map((r) => ({ ...r.rec, aIsRed: r.aIsRed })) }, null, 2));
    console.log(`\nWrote ${args.out}`);
  }
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  void workerMain();
}
