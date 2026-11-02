import { SEARCH } from './evalWeights';
import type { MctsParams } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard';

const base = {
  uctC: SEARCH.uctC,
  maxRolloutPlies: SEARCH.maxRolloutPlies,
  pwC: SEARCH.pwC,
  pwAlpha: SEARCH.pwAlpha,
};

export const PRESETS: Readonly<Record<Difficulty, MctsParams>> = {
  easy: { ...base, determinizations: 4, iterations: 150, timeBudgetMs: 300 },
  normal: { ...base, determinizations: 8, iterations: 400, timeBudgetMs: 1000 },
  hard: { ...base, determinizations: 16, iterations: 1000, timeBudgetMs: 3000 },
};

export const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = {
  easy: '簡單',
  normal: '普通',
  hard: '困難',
};
