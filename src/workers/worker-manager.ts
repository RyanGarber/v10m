import { Snowyflake } from 'snowyflake';
import { type Job, JobStatus } from '../jobs/index.js';
import { type WorkerListItem, WorkerList } from './worker-list.js';
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

  createWorker(jobs: Job[], callback?: (job: number, status: JobStatus, data: any) => void) {
    const worker: WorkerListItem = {
      jobs: jobs,
      working: false,
    };

    worker.jobs.forEach((job, index) => {
      job.on(JobStatus.Success, (_) => {
        if (index < worker.jobs.length - 1) {
          worker.jobs[index + 1].start();
        } else {
          worker.working = false;
        }
      });

      // TODO combine statuses here and return overall progress?
      for (const status of Object.values(JobStatus)) {
        job.on(status, (data) => callback?.(index, status, data));
      }
    });

    const id = this.snowyflake.nextId();
    this.workers.add(id, worker);
    this.workers.setWaiting(id);
    return id;
  }

  getWorkersWaiting() {
    return this.workers.getCountWaiting();
  }

  getWorkerPositionWaiting(id: bigint | string) {
    return this.workers.findPositionWaiting(id);
  }

  start() {
    setInterval(() => {
      for (const { id, item: worker } of this.workers) {
        const cleanupTime =
          this.snowyflake.deconstruct(id).timestamp +
          BigInt(this.configManager.config.workers.cleanupMs);

        if (BigInt(Date.now()) > cleanupTime && !worker.working) {
          console.log(`Cleaning up job ${id}...`);
          worker.jobs.forEach((job) => job.cleanup());
          this.workers.delete(id);
        }
      }

      let next;
      if (
        this.workers.getCountWorking() < this.configManager.config.workers.max &&
        (next = this.workers.getNextWaiting())
      ) {
        console.log(`Starting job ${next.id}...`);
        next.item.jobs[0].start();
        next.item.working = true;
      }
    }, this.configManager.config.workers.loopMs);
  }
}
