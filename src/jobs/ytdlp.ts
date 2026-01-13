import fs from 'fs';
import { Job, type JobOptions } from './base.js';
import { FFMPEG_NVIDIA_ARGS } from '../consts.js';
import { Command, CommandEvent, ErrorMode } from '../utils/command.js';
import chalk from 'chalk';

/**
 * YT-dlp job options
 */
export interface YTdlpJobOptions extends JobOptions {
  username?: string;
  password?: string;
  cookies?: string;
}

/**
 * YT-dlp job
 */
export class YTdlpJob extends Job {
  public title = 'video';

  constructor(
    public readonly inputUrl: string,
    public readonly outputFile: string,
    public override readonly options: YTdlpJobOptions = {}
  ) {
    super(options);
  }

  override async run() {
    // Validate protocol
    try {
      const parsed = new URL(this.inputUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Invalid protocol: ${parsed.protocol}`);
      }
    } catch {
      throw new Error(`Invalid URL: ${this.inputUrl}`);
    }

    console.log(`Starting download from ${this.inputUrl} to ${this.outputFile}`);
    this.files.push(this.outputFile);
    this.options.onProgress?.(0);

    // Check for NVIDIA GPU
    const hasNvidia = (await new Command(['nvidia-smi']).run().catch(() => false)) !== false;

    // Construct yt-dlp command
    const args = [
      'yt-dlp',
      '-o',
      this.outputFile,
      '-f',
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--js-runtime=node',
      '--print',
      'video:title=%(title)s',
      '--no-simulate',
      '--progress',
      '--newline',
    ];

    if (hasNvidia) {
      args.push(
        '--postprocessor-args',
        `ffmpeg_i:${FFMPEG_NVIDIA_ARGS.INPUT}`,
        '--postprocessor-args',
        `ffmpeg_o:${FFMPEG_NVIDIA_ARGS.OUTPUT}`
      );
    }
    if (this.options.username && this.options.password) {
      args.push('-u', this.options.username, '-p', this.options.password);
    }
    if (this.options.cookies && this.options.cookies.length > 0) {
      fs.writeFileSync(`${this.outputFile}.cookies`, this.options.cookies);
      this.files.push(`${this.outputFile}.cookies`);
      args.push('--cookies', `${this.outputFile}.cookies`);
    }
    args.push(this.inputUrl);

    const ytdlp = new Command(args, {
      captureOutput: ['stdout', 'stderr'],
      captureError: [],
      treatAsError: (line) => /error[:|\]]/im.test(line),
      onError: this.options.debug ? ErrorMode.Reject : ErrorMode.Stop | ErrorMode.Reject,
    });

    // Run yt-dlp and handle output
    ytdlp.on(CommandEvent.Data, (data) => {
      if (this.options.debug) {
        console.log(chalk.gray('| ', data.trim()));
      }
      const progressMatch = /(\d{1,3}\.\d)%/im.exec(data);
      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        this.options.onProgress?.(percent);
      }
      const titleMatch = /title=(.+)/im.exec(data);
      if (titleMatch) {
        this.title = titleMatch[1];
      }
    });

    try {
      await ytdlp.run();
    } catch (error) {
      console.error(chalk.red('YT-dlp failed:'), (error as Error).message.trim());
      if (this.options.debug) {
        console.warn(chalk.yellow('Debug mode enabled; continuing.'));
      } else {
        throw error;
      }
    }
  }
}
