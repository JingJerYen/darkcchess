import { legalActions } from '../engine';
import type { Action, Observation, RNG } from '../engine';
import { determinize } from './determinize';
import { mctsSearch } from './mcts';
import { PRESETS } from './presets';
import type { Difficulty } from './presets';
import type { Bot, MctsParams } from './types';

/** Legal actions computable from the observation alone (independent of hidden ranks). */
export function legalActionsFromObs(obs: Observation): Action[] {
  // Any determinization has the same legal actions; use a fixed dummy RNG.
  const fixed: RNG = { next: () => 0, int: () => 0 };
  return legalActions(determinize(obs, fixed));
}

export class RandomBot implements Bot {
  readonly name = 'random';
  async chooseAction(obs: Observation, rng: RNG): Promise<Action> {
    const acts = legalActionsFromObs(obs);
    return acts[rng.int(acts.length)];
  }
}

export class GreedyBot implements Bot {
  readonly name = 'greedy';
  async chooseAction(obs: Observation, rng: RNG): Promise<Action> {
    const acts = legalActionsFromObs(obs);
    let best: Action[] = [];
    let bestRank = 0;
    for (const a of acts) {
      if (a.type !== 'move') continue;
      const t = obs.board[a.to];
      if (t === null || t.rank === null) continue;
      if (t.rank > bestRank) {
        bestRank = t.rank;
        best = [a];
      } else if (t.rank === bestRank) best.push(a);
    }
    const pool = best.length > 0 ? best : acts;
    return pool[rng.int(pool.length)];
  }
}

export function mctsChoose(obs: Observation, rng: RNG, params: MctsParams): Action {
  return mctsSearch(obs, rng, params).action;
}

export class MctsBot implements Bot {
  readonly name: string;
  readonly params: MctsParams;
  constructor(preset: Difficulty | MctsParams, name?: string) {
    this.params = typeof preset === 'string' ? PRESETS[preset] : preset;
    this.name = name ?? (typeof preset === 'string' ? `mcts:${preset}` : 'mcts');
  }
  async chooseAction(obs: Observation, rng: RNG): Promise<Action> {
    return mctsChoose(obs, rng, this.params);
  }
}

