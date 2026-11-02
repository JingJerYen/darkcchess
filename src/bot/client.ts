/** Browser-side bot runner: runs the search in a Web Worker, falls back to a synchronous easy search. */
import { createRng } from '../engine';
import type { Action, Observation } from '../engine';
import { mctsSearch } from './mcts';
import { PRESETS } from './presets';
import type { Difficulty } from './presets';
import type { BotRequest } from './worker';

interface Pending {
  resolve: (a: Action) => void;
  reject: (e: Error) => void;
}

export class BotRunner {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** True once the worker failed and the synchronous fallback is in use. */
  fallback = false;

  constructor() {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; action?: Action; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.action) p.resolve(e.data.action);
        else p.reject(new Error(e.data.error ?? 'worker error'));
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.failWorker(new Error(e.message || 'worker crashed'));
      };
    } catch {
      this.worker = null;
      this.fallback = true;
    }
  }

  private failWorker(err: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.fallback = true;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  async choose(obs: Observation, difficulty: Difficulty, seed: number): Promise<Action> {
    const params = PRESETS[difficulty];
    if (this.worker !== null) {
      try {
        return await new Promise<Action>((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve, reject });
          const timer = setTimeout(() => {
            if (this.pending.has(id)) this.failWorker(new Error('worker timeout'));
          }, params.timeBudgetMs + 10_000);
          const done = (f: () => void) => () => {
            clearTimeout(timer);
            f();
          };
          this.pending.set(id, {
            resolve: (a) => done(() => resolve(a))(),
            reject: (e) => done(() => reject(e))(),
          });
          const req: BotRequest = { id, obs, params, seed };
          this.worker!.postMessage(req);
        });
      } catch (err) {
        console.warn('Bot worker failed, using synchronous fallback', err);
        this.failWorker(err instanceof Error ? err : new Error(String(err)));
      }
    }
    // Synchronous fallback (easy preset); yield first so the UI can paint.
    await new Promise((r) => setTimeout(r, 30));
    return mctsSearch(obs, createRng(seed), PRESETS.easy).action;
  }
}
