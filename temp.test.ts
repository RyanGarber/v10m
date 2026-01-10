import chalk from 'chalk';
import { ConfigManager } from './src/config.js';
import * as jobs from './src/jobs/index.js';
import * as workers from './src/workers/index.js';

const testUrls = ['https://youtube.com/shorts/DC8lWmZ3GpE?si=nrejbVZuowYsBElq'];

const testJobs = [
  new jobs.YTdlpJob('https://asdasdas.com/asa', 'temp.test.mp4', {
    onProgress(percent) {
      console.log(`Download progress: ${percent}%`);
    },
  }),
  new jobs.FFmpegJob('temp.test.mp4', 'temp.test.out.mp4', {
    targetSizeKb: 10000,
    onProgress(percent) {
      console.log(`Transcode progress: ${percent}%`);
    },
  }),
];

const manager = new workers.WorkerManager(new ConfigManager({ debug: false }));
manager.start();
manager.addWorkerToQueue({
  jobs: testJobs,
  onFinished: () => {
    console.log(chalk.green('All jobs finished!'));
  },
  onFailed: (jobIndex, error) => {
    console.log(chalk.red(`Job ${jobIndex} failed: ${error.message.trim()}`));
  },
});
