import { type WorkerInstance } from '../workers/index.js';

/**
 * Worker list
 */
export class WorkerList {
  private total: Map<bigint, WorkerInstance>;
  private waiting: bigint[];

  constructor() {
    this.total = new Map();
    this.waiting = [];
  }

  get(id: bigint | string) {
    return this.total.get(BigInt(id));
  }

  add(id: bigint | string, item: WorkerInstance) {
    this.total.set(BigInt(id), item);
  }

  delete(id: bigint | string) {
    this.total.delete(BigInt(id));
  }

  setWaiting(id: bigint | string) {
    const bigId = BigInt(id);
    if (!this.waiting.includes(bigId)) {
      this.waiting.push(bigId);
    }
  }

  findPositionWaiting(id: bigint | string) {
    return this.waiting.indexOf(BigInt(id));
  }

  getCountWaiting() {
    return this.waiting.length;
  }

  getCountWorking() {
    return [...this.total.values()].filter((item) => item.working).length;
  }

  getCountTotal() {
    return this.total.size;
  }

  getNextWaiting() {
    if (this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      const item = this.total.get(id)!;
      return [id, item] as const;
    }
    return undefined;
  }

  *[Symbol.iterator]() {
    for (const [id, item] of this.total) {
      yield [id, item] as const;
    }
  }
}
