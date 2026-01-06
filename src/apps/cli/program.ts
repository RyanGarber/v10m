import fs from 'fs';
import { Command } from 'commander';
import { ConfigManager, type PartialConfig } from '../../config.js';
import { WorkerManager } from '../../workers/worker-manager.js';
import { FFmpegJob, type FFmpegJobOptions } from '../../jobs/ffmpeg.js';
import { YTdlpJob, type YTdlpJobOptions } from '../../jobs/ytdlp.js';
import pkg from '../../../package.json' with { type: 'json' };

/**
 * v10m CLI
 */
export class CliProgram {
  private configs: ConfigManager;
  private workers: WorkerManager;
  private program: Command;

  constructor() {
    this.configs = new ConfigManager();

    this.workers = new WorkerManager(this.configs);
    this.workers.start();

    this.program = new Command();

    this.program
      .name('v10m')
      .description(pkg.description)
      .version(pkg.version + (process.env.V10M_DEV ? ` (debug)` : ''))
      .option('--debug', 'enable debug mode')
      .option('--workers <number>', 'maximum number of workers', parseInt)
      .option('--workers-loop <ms>', 'worker loop interval in ms', parseInt)
      .hook('preAction', (thisCommand) => {
        const options = thisCommand.opts();
        const overrides: PartialConfig = {};

        if (options.debug) {
          overrides.debug = true;
        }
        if (options.workers) {
          overrides.workers = { max: options.workers };
        }
        if (options.workersLoop) {
          overrides.workers = {
            ...overrides.workers,
            loopMs: options.workersLoop,
          };
        }

        this.configs.update(overrides);
      });

    this.program
      .command('download <url>')
      .description('Download H264/AAC (.MP4) from URL')
      .option('-u, --username <username>', 'username for authentication')
      .option('-p, --password <password>', 'password for authentication')
      .option('-c, --cookies <path>', 'path to cookies file')
      .option('-o, --output <path>', 'output file', './$(title)s.mp4')
      .action(
        (
          url,
          options: {
            username?: string;
            password?: string;
            cookies?: string;
            output: string;
          }
        ) => {
          console.log(`Downloading ${url} to ${options.output}`);
          const ytdlpOptions: YTdlpJobOptions = {
            username: options.username,
            password: options.password,
            cookies: options.cookies ? fs.readFileSync(options.cookies, 'utf-8') : undefined,
          };
          this.workers.createWorker(
            [new YTdlpJob(url, options.output, ytdlpOptions)],
            (jobId, status, data) => console.log(`[${status}] ${data}`)
          );
        }
      );

    this.program
      .command('transcode <input>')
      .description('Transcode video to MP4 format')
      .option('-o, --output <path>', 'output file', './%(input)s.out.mp4')
      .option('-k, --filesize-kilobytes <kb>', 'target file size in kilobytes', parseInt)
      .action((input, options) => {
        options.output = options.output.replace(
          '%(input)s',
          input.slice(input.lastIndexOf('/') + 1, input.lastIndexOf('.'))
        );
        console.log(`Transcoding ${input} to ${options.output}`);
        const ffmpegOptions: FFmpegJobOptions = {
          fileSizeKilobytes: options.filesizeKilobytes,
        };
        this.workers.createWorker(
          [new FFmpegJob(input, options.output, ffmpegOptions)],
          (jobId, status, data) => console.log(`[${status}] ${data}`)
        );
      });
  }

  run(argv: string[]): void {
    this.program.parse(argv);
  }
}
