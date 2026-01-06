import { ConfigManager } from './src/config.js';
import * as jobs from './src/jobs/index.js';
import * as workers from './src/workers/index.js';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

const tests = ['https://youtube.com/shorts/DC8lWmZ3GpE?si=nrejbVZuowYsBElq'];

const workerLogs = (job: number, status: jobs.JobStatus, data: any) => {
  console.log(
    `[WORKER] [${typeof job}] [${status}] >>> ${(job === 1 ? 50 : 0)}: ${data.percent / 2}`,
    data
  );
};

const jobLogs = (job: jobs.Job) => {
  return job
    .on(jobs.JobStatus.Progress, (data) => console.log('[PROGRESS]', data))
    .on(jobs.JobStatus.Success, (data) => console.log('[SUCCESS]', data))
    .on(jobs.JobStatus.Failure, (data) => console.error('[FAILURE]', data));
};

const manager = new workers.WorkerManager(new ConfigManager({ debug: true }));
manager.start();

manager.createWorker([
  jobLogs(new jobs.YTdlpJob('https://asdasdas.com/asa', 'temp.test.mp4', { debug: true })),
  jobLogs(new jobs.FFmpegJob('temp.test.mp4', 'temp.test.out.mp4', { fileSizeKilobytes: 10000, debug: true }))
], workerLogs);