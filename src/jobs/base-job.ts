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
  on(status: JobStatus, callback: (data: any) => void) {
    this.addEventListener(status, (event: Event) => callback((event as CustomEvent).detail));
    return this;
  }

  protected emit(status: JobStatus, data: any) {
    this.dispatchEvent(new CustomEvent(status, { detail: data }));
  }

  start() {
    console.error('Start method not implemented.');
  }
}
