import { Snowyflake } from 'snowyflake';
import { type Worker, WorkerInstance, WorkerList } from './index.js';
import type { ConfigManager } from '../config.js';

/**
 * Worker manager
 */
export class WorkerManager {
  private workers: WorkerList;
  private snowyflake: Snowyflake;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.workers = new WorkerList();
    this.snowyflake = new Snowyflake();
    this.configManager = configManager;
  }

  addWorkerToQueue(worker: Worker) {
    const id = this.snowyflake.nextId();
    this.workers.add(id, WorkerInstance.fromWorker(worker));
    this.workers.setWaiting(id);
    return id;
  }

  getWorker(id: bigint | string) {
    return this.workers.get(typeof id === 'string' ? BigInt(id) : id);
  }

  getWorkersWaiting() {
    return this.workers.getCountWaiting();
  }

  getWorkerPositionWaiting(id: bigint | string) {
    return this.workers.findPositionWaiting(id);
  }

  start() {
    setInterval(() => {
      for (const [id, worker] of this.workers) {
        const cleanupTime =
          this.snowyflake.deconstruct(id).timestamp +
          BigInt(this.configManager.config.workers.cleanupMs);

        if (BigInt(Date.now()) > cleanupTime && !worker.working) {
          console.log(`Cleaning up worker ${id}...`);
          void worker.cleanup();
          this.workers.delete(id);
        }
      }
    }, this.configManager.config.workers.loopMs);

    setInterval(() => {
      if (this.workers.getCountWorking() < this.configManager.config.workers.max) {
        const [id, worker] = this.workers.getNextWaiting() ?? [];
        if (worker) {
          console.log(`Starting worker ${id}...`);
          void worker.start(this.configManager.config.debug);
        }
      }
    }, this.configManager.config.workers.loopMs);
  }
}
