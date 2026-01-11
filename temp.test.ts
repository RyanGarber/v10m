import chalk from 'chalk';
import { ConfigManager } from './src/config.js';
import * as jobs from './src/jobs/index.js';
import * as workers from './src/workers/index.js';

const testUrls = ['https://www.instagram.com/reels/DTR4h5AAGrg/'];

const testJobs = [new jobs.YTdlpJob(testUrls[0], 'temp.test.mp4')];

const manager = new workers.WorkerManager(new ConfigManager({ debug: true }));
manager.start();
const id = manager.addWorkerToQueue({
  jobs: testJobs,
  onFinished: () => {
    console.log(manager.getWorker(id)!.getFirstJobOfType(jobs.YTdlpJob)!.title);
    console.log(chalk.green('All jobs finished!'));
    process.exit(0);
  },
  onFailed: (jobIndex, error) => {
    console.log(chalk.red(`Job ${jobIndex} failed: ${error.message.trim()}`));
  },
});
