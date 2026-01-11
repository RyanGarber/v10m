import { type Job } from '../jobs/index.js';

/**
 * Worker
 */
export class Worker {
  constructor(
    public jobs: Job[],
    public onFinished?: () => void,
    public onFailed?: (jobIndex: number, error: Error) => void,
    public onProgress?: (jobIndex: number, percent: number) => void
  ) {}
}

export class WorkerInstance extends Worker {
  working = false;

  async start(debug = false) {
    this.working = true;
    let jobIndex = 0;
    try {
      for (const job of this.jobs) {
        job.options.debug = debug;
        job.options.onProgress = (percent) => this.onProgress?.(jobIndex, percent);
        await job.run();
        jobIndex++;
      }
      this.onFinished?.();
    } catch (error) {
      this.onFailed?.(jobIndex, error as Error);
    } finally {
      this.working = false;
    }
  }

  async cleanup() {
    for (const job of this.jobs) {
      await job.cleanup();
    }
  }

  getFirstJobOfType<T>(jobType: new (...args: never[]) => T): T | null {
    return (this.jobs.find((job) => job instanceof jobType) as T) ?? null;
  }

  static fromWorker(worker: Worker): WorkerInstance {
    return new WorkerInstance(worker.jobs, worker.onFinished, worker.onFailed, worker.onProgress);
  }
}
