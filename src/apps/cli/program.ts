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
  private configManager: ConfigManager;
  private workers: WorkerManager;
  private program: Command;

  constructor() {
    this.configManager = new ConfigManager();

    this.workers = new WorkerManager(this.configManager);
    this.workers.start();

    this.program = new Command();

    this.program
      .name('v10m')
      .description(pkg.description)
      .version(pkg.version + (process.env.V10M_DEV ? ` (debug)` : ''))
      .option('-d, --debug', 'enable debug mode')
      .hook('preAction', (thisCommand) => {
        const options = thisCommand.opts();
        const overrides: PartialConfig = {};

        if (options.debug) {
          overrides.debug = true;
        }

        this.configManager.update(overrides);
      });

    this.program
      .command('download <url>')
      .description('Download H264/AAC (.MP4) from URL')
      .option('-u, --username <username>', 'username for authentication')
      .option('-p, --password <password>', 'password for authentication')
      .option('-c, --cookies <path>', 'path to cookies file')
      .option('-o, --output <path>', 'output file', './%(title)s.mp4')
      .action(
        (
          url: string,
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
          this.workers.addWorkerToQueue({
            jobs: [new YTdlpJob(url, options.output, ytdlpOptions)],
            onFinished: () => console.log(`Download finished: ${options.output}`),
            onFailed: (error) => console.log(`Download failed:`, error),
            onProgress: (percent) => console.log(`Download progress: ${percent}%`),
          });
        }
      );

    this.program
      .command('transcode <input>')
      .description('Transcode video to MP4 format')
      .option('-o, --output <path>', 'output file', './%(input)s.out.mp4')
      .option('-k, --target-size-kb <kb>', 'target file size in kilobytes', parseInt)
      .action((input: string, options: { output: string; targetSizeKb?: number }) => {
        options.output = options.output.replace(
          '%(input)s',
          input.slice(input.lastIndexOf('/') + 1, input.lastIndexOf('.'))
        );
        console.log(`Transcoding ${input} to ${options.output}`);
        const ffmpegOptions: FFmpegJobOptions = {
          targetSizeKb: options.targetSizeKb,
        };
        this.workers.addWorkerToQueue({
          jobs: [new FFmpegJob(input, options.output, ffmpegOptions)],
          onFinished: () => console.log(`Transcode finished: ${options.output}`),
          onFailed: (error) => console.log(`Transcode failed:`, error),
          onProgress: (percent) => console.log(`Transcode progress: ${percent}%`),
        });
      });
  }

  run(argv: string[]): void {
    this.program.parse(argv);
  }
}
