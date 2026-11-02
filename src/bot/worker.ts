/// <reference lib="webworker" />
import { createRng } from '../engine';
import { mctsSearch } from './mcts';
import type { Observation } from '../engine';
import type { MctsParams } from './types';

export interface BotRequest {
  id: number;
  obs: Observation;
  params: MctsParams;
  seed: number;
}

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, obs, params, seed } = e.data;
  try {
    const { action, stats } = mctsSearch(obs, createRng(seed), params);
    self.postMessage({ id, action, stats });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
