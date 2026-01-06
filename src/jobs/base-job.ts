import fs from 'fs';

/**
 * Job statuses
 */
export enum JobStatus {
  Success = 'success',
  Failure = 'failure',
  Progress = 'progress',
}

/**
 * Base job class
 */
export class Job extends EventTarget {
  protected outputs: string[] = [];

  on(status: JobStatus, callback: (data: any) => void) {
    this.addEventListener(status, (event: Event) => callback((event as CustomEvent).detail));
    return this;
  }

  protected emit(status: JobStatus, data: any) {
    this.dispatchEvent(new CustomEvent(status, { detail: data }));
  }

  start() {
    throw new Error('Start method not implemented on job');
  }

  cleanup() {
    for (const file of this.outputs) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (err) {
        console.warn(`Failed to cleanup job output ${file}:`, err);
      }
    }
  }
}
