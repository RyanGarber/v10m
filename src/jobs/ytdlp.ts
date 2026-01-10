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
  onProgress?: (percent: number) => void;
}

/**
 * YT-dlp job
 */
export class YTdlpJob extends Job {
  constructor(
    private inputUrl: string,
    private outputFile: string,
    options: YTdlpJobOptions = {}
  ) {
    super(options);
  }

  async run() {
    console.log(`Starting download from ${this.inputUrl} to ${this.outputFile}`);
    this.files.push(this.outputFile);
    (this.options as YTdlpJobOptions).onProgress?.(0);

    // Check for NVIDIA GPU
    const hasNvidia = (await new Command('nvidia-smi').run().catch(() => false)) !== false;

    // Construct yt-dlp command
    let command = `yt-dlp -o ${this.outputFile} -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b" -v --js-runtime=node`;
    if (hasNvidia) {
      command += ` --postprocessor-args "ffmpeg_i:${FFMPEG_NVIDIA_ARGS.INPUT}" --postprocessor-args "ffmpeg_o:${FFMPEG_NVIDIA_ARGS.OUTPUT}"`;
    }
    if ((this.options as YTdlpJobOptions).username && (this.options as YTdlpJobOptions).password) {
      command += ` -u ${(this.options as YTdlpJobOptions).username} -p ${(this.options as YTdlpJobOptions).password}`;
    }
    if (
      (this.options as YTdlpJobOptions).cookies &&
      (this.options as YTdlpJobOptions).cookies!.length > 0
    ) {
      fs.writeFileSync(`${this.outputFile}.cookies`, (this.options as YTdlpJobOptions).cookies!);
      this.files.push(`${this.outputFile}.cookies`);
      command += ` --cookies ${this.outputFile}.cookies`;
    }
    command += ` ${this.inputUrl}`;

    const ytdlp = new Command(command, {
      captureOutput: ['stderr'],
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
        (this.options as YTdlpJobOptions).onProgress?.(percent);
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
