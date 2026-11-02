/** Seedable pseudo-random number generator (mulberry32). Pure: no global state. */
export interface RNG {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

export class SeededRng implements RNG {
  private s: number;

  constructor(seed: number) {
    // Mix the seed so that small consecutive seeds give unrelated streams.
    let h = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    this.s = (h ^ (h >>> 16)) >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Derive an independent 32-bit seed (for child RNGs). */
  nextSeed(): number {
    return Math.floor(this.next() * 4294967296);
  }
}

export function createRng(seed: number): SeededRng {
  return new SeededRng(seed);
}

/** In-place Fisher–Yates shuffle. */
export function shuffleInPlace<T>(arr: T[], rng: RNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
