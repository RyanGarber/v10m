import fs from 'fs';
import { Job, type JobOptions } from './base.js';
import { Command, CommandEvent, ErrorMode } from '../utils/command.js';
import {
  FFMPEG_AUDIO_BITRATE,
  FFMPEG_VIDEO_BITRATE_BUFFER,
  FFMPEG_VIDEO_BITRATE_DEFAULT,
  FFMPEG_NVIDIA_ARGS,
} from '../consts.js';
import chalk from 'chalk';

/**
 * FFmpeg job options
 */
export interface FFmpegJobOptions extends JobOptions {
  targetSizeKb?: number;
}

/**
 * FFmpeg job
 */
export class FFmpegJob extends Job {
  constructor(
    public readonly inputFile: string,
    public readonly outputFile: string,
    public override readonly options: FFmpegJobOptions = {}
  ) {
    super(options);
  }

  override async run() {
    console.log(`Starting transcode from ${this.inputFile} to ${this.outputFile}`);
    this.files.push(this.outputFile);
    this.options.onProgress?.(0);

    // Check for NVIDIA GPU
    const hasNvidia = (await new Command(['nvidia-smi']).run().catch(() => false)) !== false;

    // Get input video duration
    let seconds = -1;

    const ffprobe = new Command(['ffprobe', '-i', this.inputFile], {
      captureOutput: ['stderr'],
      captureError: [],
      onError: ErrorMode.None,
    });

    ffprobe.on(CommandEvent.Data, (data) => {
      const durationString = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(data);
      if (durationString) {
        seconds =
          parseInt(durationString[1], 10) * 3600 +
          parseInt(durationString[2], 10) * 60 +
          parseFloat(durationString[3]);
      }
    });

    await ffprobe.run();

    // Calculate target video bitrate
    const maxSizeKilobits =
      (this.options.targetSizeKb ?? fs.statSync(this.inputFile).size / 1024) * 8;
    let bitrate =
      (maxSizeKilobits / seconds - FFMPEG_AUDIO_BITRATE) * (1 - FFMPEG_VIDEO_BITRATE_BUFFER);

    if (seconds === -1) {
      console.warn(chalk.yellow('ffprobe failed; compression and progress not available.'));
      bitrate = FFMPEG_VIDEO_BITRATE_DEFAULT;
    }
    bitrate = Math.max(100, Math.min(bitrate, FFMPEG_VIDEO_BITRATE_DEFAULT));
    console.log(`Using target video bitrate: ${Math.floor(bitrate)} kbps`);

    // Construct ffmpeg arguments
    const args = ['ffmpeg'];
    if (hasNvidia) {
      args.push(...FFMPEG_NVIDIA_ARGS.INPUT.split(' '));
    }
    args.push('-i', this.inputFile, '-progress', 'pipe:2');
    if (hasNvidia) {
      args.push(...FFMPEG_NVIDIA_ARGS.OUTPUT.split(' '));
    }
    args.push(
      '-b:v',
      `${Math.floor(bitrate)}k`,
      '-b:a',
      `${FFMPEG_AUDIO_BITRATE}k`,
      '-y',
      this.outputFile
    );

    // Run ffmpeg and handle output
    const ffmpeg = new Command(args, {
      captureOutput: ['stderr'],
      captureError: [],
      treatAsError: (line) => /error[:|\]]/im.test(line),
      onError: this.options.debug ? ErrorMode.Reject : ErrorMode.Stop | ErrorMode.Reject,
    });

    ffmpeg.on(CommandEvent.Data, (data) => {
      if (this.options.debug) {
        console.log(chalk.gray('| ', data.trim()));
      }
      const timeString = /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/im.exec(data);
      if (timeString && seconds !== -1) {
        const timeSeconds =
          parseInt(timeString[1], 10) * 3600 +
          parseInt(timeString[2], 10) * 60 +
          parseFloat(timeString[3]);
        const progress = Math.min(Math.round((timeSeconds / seconds) * 100), 100);

        this.options.onProgress?.(progress);
      }
    });

    try {
      await ffmpeg.run();
    } catch (error) {
      console.error(chalk.red('FFmpeg failed:'), (error as Error).message.trim());
      if (this.options.debug) {
        console.warn(chalk.yellow('Debug mode enabled; continuing.'));
      } else {
        throw error;
      }
    }
  }
}
