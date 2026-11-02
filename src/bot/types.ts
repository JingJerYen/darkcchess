import type { Action, Observation, RNG } from '../engine';

export interface Bot {
  readonly name: string;
  /** Must only use `obs`; never the full game state. */
  chooseAction(obs: Observation, rng: RNG): Promise<Action>;
}

export interface MctsParams {
  /** Number of determinizations (D). */
  determinizations: number;
  /** MCTS iterations per determinization (I). */
  iterations: number;
  /** Wall-clock limit per decision. */
  timeBudgetMs: number;
  uctC: number;
  maxRolloutPlies: number;
  pwC: number;
  pwAlpha: number;
}
