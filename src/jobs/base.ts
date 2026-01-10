import fs from 'fs/promises';

/**
 * Base job options
 */
export interface JobOptions {
  debug?: boolean;
  onFinished?: () => void;
  onFailed?: (error: Error) => void;
}

/**
 * Base job class
 */
export class Job {
  options: JobOptions;
  files: string[] = [];

  constructor(options: JobOptions = {}) {
    this.options = options;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async run() {
    throw new Error('Run method not implemented on job');
  }

  async cleanup() {
    for (const file of this.files) {
      try {
        if (await fs.stat(file).catch(() => false)) {
          await fs.unlink(file);
        }
      } catch (err) {
        console.warn(`Failed to cleanup job output ${file}:`, err);
      }
    }
  }
}
