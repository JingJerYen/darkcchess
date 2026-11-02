import { actionKey, applyActionUnchecked, drawRank, legalActions } from '../engine';
import type { Action, GameState, Observation, RNG, Side } from '../engine';
import { determinize, sampleRank } from './determinize';
import { evaluateRed, orderedActions, rolloutAction } from './policy';
import type { MctsParams } from './types';

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/**
 * Tree node. `mover` is the side whose decision (or draw) led to this node;
 * `value` accumulates rewards from that side's perspective.
 */
class Node {
  visits = 0;
  value = 0;
  children: Node[] = [];
  untried: Action[] | null = null;
  /** Only for chance nodes: outcome children keyed by drawn rank. */
  outcomes: Map<number, Node> | null = null;

  constructor(
    /** For chance nodes: the state *before* the draw. */
    readonly state: GameState,
    readonly action: Action | null,
    readonly mover: Side | null,
    readonly chance: boolean,
  ) {
    if (chance) this.outcomes = new Map();
  }
}

export interface SearchStats {
  iterations: number;
  determinizations: number;
  elapsedMs: number;
  visits: Record<string, number>;
}

function rewardFor(side: Side | null, redReward: number): number {
  return side === 'black' ? 1 - redReward : redReward;
}

/** Sample a chance outcome at `node` (draw a rank uniformly from the pool). */
function chanceChild(node: Node, rng: RNG): { child: Node; created: boolean } {
  const st = node.state;
  const rank = sampleRank(st.pools[st.toMove], rng);
  let child = node.outcomes!.get(rank);
  if (child) return { child, created: false };
  child = new Node(drawRank(st, rank), null, st.toMove, false);
  node.outcomes!.set(rank, child);
  return { child, created: true };
}

export function rollout(state: GameState, rng: RNG, maxPlies: number): number {
  let s = state;
  for (let i = 0; i < maxPlies && s.result === null; i++) {
    const a = rolloutAction(s, rng);
    s = a.type === 'draw' ? drawRank(s, sampleRank(s.pools[s.toMove], rng)) : applyActionUnchecked(s, a);
  }
  return evaluateRed(s);
}

function iterate(root: Node, rng: RNG, p: MctsParams): void {
  const path: Node[] = [root];
  let node = root;
  for (;;) {
    if (node.state.result !== null && !node.chance) break;
    if (node.chance) {
      const { child, created } = chanceChild(node, rng);
      node = child;
      path.push(node);
      if (created) break;
      continue;
    }
    if (node.untried === null) node.untried = orderedActions(node.state, rng).reverse();
    const limit = Math.ceil(p.pwC * Math.pow(node.visits + 1, p.pwAlpha));
    if (node.untried.length > 0 && node.children.length < limit) {
      const a = node.untried.pop()!;
      const st = node.state;
      if (a.type === 'draw') {
        const c = new Node(st, a, st.toMove, true);
        node.children.push(c);
        path.push(c);
        const { child } = chanceChild(c, rng);
        path.push(child);
        node = child;
      } else {
        const c = new Node(applyActionUnchecked(st, a), a, st.toMove, false);
        node.children.push(c);
        path.push(c);
        node = c;
      }
      break;
    }
    // UCT selection
    const logN = Math.log(node.visits + 1);
    let best: Node | null = null;
    let bestScore = -Infinity;
    for (const c of node.children) {
      const score = c.value / c.visits + p.uctC * Math.sqrt(logN / c.visits);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    node = best!;
    path.push(node);
  }
  const st = node.state;
  const red = st.result !== null ? evaluateRed(st) : rollout(st, rng, p.maxRolloutPlies);
  for (const n of path) {
    n.visits++;
    n.value += rewardFor(n.mover, red);
  }
}

/** PIMC-MCTS over `obs`. Only the observation is used. */
export function mctsSearch(obs: Observation, rng: RNG, p: MctsParams): { action: Action; stats: SearchStats } {
  const start = now();
  const first = determinize(obs, rng);
  const rootActions = legalActions(first);
  if (rootActions.length === 0) throw new Error('mctsSearch: no legal actions');
  const visits: Record<string, number> = {};
  const values: Record<string, number> = {};
  const byKey = new Map<string, Action>();
  for (const a of rootActions) byKey.set(actionKey(a), a);
  const stats: SearchStats = { iterations: 0, determinizations: 0, elapsedMs: 0, visits };
  if (rootActions.length === 1) {
    stats.elapsedMs = now() - start;
    return { action: rootActions[0], stats };
  }
  const deadline = start + p.timeBudgetMs;
  for (let d = 0; d < p.determinizations; d++) {
    if (d > 0 && now() >= deadline) break;
    const state = d === 0 ? first : determinize(obs, rng);
    const detDeadline = start + (p.timeBudgetMs * (d + 1)) / p.determinizations;
    const root = new Node(state, null, null, false);
    for (let i = 0; i < p.iterations; i++) {
      if ((i & 7) === 7 && now() >= detDeadline) break;
      iterate(root, rng, p);
      stats.iterations++;
    }
    stats.determinizations++;
    for (const c of root.children) {
      const k = actionKey(c.action!);
      visits[k] = (visits[k] ?? 0) + c.visits;
      values[k] = (values[k] ?? 0) + c.value;
    }
  }
  let bestKey = '';
  let bestV = -1;
  let bestQ = -1;
  for (const k of Object.keys(visits)) {
    const v = visits[k];
    const q = values[k] / Math.max(1, v);
    if (v > bestV || (v === bestV && q > bestQ)) {
      bestV = v;
      bestQ = q;
      bestKey = k;
    }
  }
  stats.elapsedMs = now() - start;
  const action = byKey.get(bestKey) ?? rootActions[0];
  return { action, stats };
}
