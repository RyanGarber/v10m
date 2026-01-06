import fs from 'fs';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { Job, JobStatus } from './base-job.js';
import { NVIDIA_FFMPEG_ARGS } from '../consts.js';

/**
 * YT-dlp job options
 */
export interface YTdlpJobOptions {
  username?: string;
  password?: string;
  cookies?: string;
  debug?: boolean;
}

/**
 * YT-dlp job
 */
export class YTdlpJob extends Job {
  private inputUrl: string;
  private outputFile: string;
  private options: YTdlpJobOptions;

  private ytdlp: ChildProcessWithoutNullStreams | null = null;

  constructor(inputUrl: string, outputFile: string, options: YTdlpJobOptions = {}) {
    super();
    this.inputUrl = inputUrl;
    this.outputFile = outputFile;
    this.options = options;
  }

  #handle(scope: string, data: any, isError: boolean) {
    if (!data) {
      return false;
    }

    if (this.options.debug) {
      console.log(`[${scope}] ${data.toString()}`);
      if (isError) {
        console.log('----- FAILURE - WOULD EXIT HERE -----');
      }
    } else if (isError) {
      try {
        this.ytdlp!.kill();
      } catch (e: any) {
        console.log(`[${scope}] Failed to kill process: ${e.toString()}`);
      }
      if (fs.existsSync(`${this.outputFile}`)) {
        fs.unlinkSync(`${this.outputFile}`);
      }
      if (fs.existsSync(`${this.outputFile}.cookies`)) {
        fs.unlinkSync(`${this.outputFile}.cookies`);
      }
      this.emit(JobStatus.Failure, `[${scope}] ${data.toString()}`);
      return true;
    }

    return false;
  }

  start() {
    console.log(`Starting download from ${this.inputUrl} to ${this.outputFile}`);
    this.emit(JobStatus.Progress, { percent: 0 });

    const nvidia = spawn('nvidia-smi');
    nvidia.on('close', (nvidiaExit) => {
      // Prepare yt-dlp arguments
      const ytdlpArgs = [
        '-o',
        this.outputFile,
        '-f',
        'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        '-v',
        '--js-runtime=node',
        ...(nvidiaExit === 0
          ? [
              '--postprocessor-args',
              `ffmpeg_i:${NVIDIA_FFMPEG_ARGS.INPUT}`,
              '--postprocessor-args',
              `ffmpeg_o:${NVIDIA_FFMPEG_ARGS.OUTPUT}`,
            ]
          : []),
      ];

      if (this.options.username && this.options.password) {
        ytdlpArgs.push('-u', this.options.username, '-p', this.options.password);
      }
      if (this.options.cookies && this.options.cookies.length > 0) {
        fs.writeFileSync(`${this.outputFile}.cookies`, this.options.cookies);
        ytdlpArgs.push('--cookies', `${this.outputFile}.cookies`);
      }

      ytdlpArgs.push(this.inputUrl);

      // Start yt-dlp process
      this.ytdlp = spawn('yt-dlp', ytdlpArgs);

      this.ytdlp.on('error', (error) => {
        if (this.#handle('yt-dlp::error', error, true)) {
          return;
        }
      });

      this.ytdlp.on('close', (code) => {
        if (this.#handle('yt-dlp::close', code, code !== 0)) {
          return;
        }
        this.emit(JobStatus.Success, { file: this.outputFile });
      });

      this.ytdlp.stderr.on('data', (data) => {
        data = data.toString();
        if (this.#handle('yt-dlp::out', data, /error[:|\]]/im.test(data))) {
          return;
        }
      });
    });
  }
}
