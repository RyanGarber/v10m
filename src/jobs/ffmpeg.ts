import fs from 'fs';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { Job, JobStatus } from './base-job.js';
import {
  FFMPEG_AUDIO_BITRATE,
  FFMPEG_VIDEO_BITRATE_BUFFER,
  FFMPEG_NVIDIA_ARGS,
} from '../consts.js';

/**
 * FFmpeg job options
 */
export interface FFmpegJobOptions {
  targetSizeKb?: number;
  debug?: boolean;
}

/**
 * FFmpeg job
 */
export class FFmpegJob extends Job {
  private inputFile: string;
  private outputFile: string;
  private options: FFmpegJobOptions;

  private ffmpeg: ChildProcessWithoutNullStreams | null = null;

  constructor(inputFile: string, outputFile: string, options: FFmpegJobOptions = {}) {
    super();
    this.inputFile = inputFile;
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
        this.ffmpeg!.kill();
      } catch (e: any) {
        console.log(`[${scope}] Failed to kill ffmpeg process: ${e.toString()}`);
      }
      this.emit(JobStatus.Failure, `[${scope}] ${data.toString()}`);
      return true;
    }

    return false;
  }

  start() {
    console.log(`Starting transcode from ${this.inputFile} to ${this.outputFile}`);
    this.files.push(this.outputFile);
    this.emit(JobStatus.Progress, { percent: 0 });

    const nvidia = spawn('nvidia-smi');
    nvidia
      .on('error', (_) => {
        /* Ignore errors */
      })
      .on('close', (nvidiaExit) => {
        // Get video duration
        const t = spawn('ffprobe', ['-i', this.inputFile]);
        t.stderr.on('data', (data) => {
          if (this.#handle('ffprobe::out', data, /error[:|\]]/im.test(data))) {
            return;
          }

          const durationString = data.toString().match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
          if (!durationString) {
            return;
          }

          const durationSeconds =
            parseInt(durationString[1], 10) * 3600 +
            parseInt(durationString[2], 10) * 60 +
            parseFloat(durationString[3]);
          const maxSizeKilobits =
            (this.options.targetSizeKb ?? fs.statSync(this.inputFile).size / 1024) * 8;
          const bitrate =
            (maxSizeKilobits / durationSeconds - FFMPEG_AUDIO_BITRATE) *
            (1 - FFMPEG_VIDEO_BITRATE_BUFFER);
          console.log(`Using target video bitrate: ${Math.floor(bitrate)} kbps`);

          // Prepare ffmpeg arguments
          const ffmpegArgs = [
            ...(nvidiaExit === 0 ? FFMPEG_NVIDIA_ARGS.INPUT.split(' ') : []),
            '-i',
            this.inputFile,
            '-progress',
            'pipe:2',
            ...(nvidiaExit === 0 ? FFMPEG_NVIDIA_ARGS.OUTPUT.split(' ') : []),
            '-b:v',
            `${Math.floor(bitrate)}k`,
            '-b:a',
            `${FFMPEG_AUDIO_BITRATE}k`,
            '-y',
            this.outputFile,
          ];

          // Start ffmpeg process
          this.ffmpeg = spawn('ffmpeg', ffmpegArgs);

          this.ffmpeg.on('error', (error) => {
            if (this.#handle('ffmpeg::error', error, true)) {
              return;
            }
          });

          this.ffmpeg.on('close', (code) => {
            if (this.#handle('ffmpeg::close', code, code !== 0)) {
              return;
            }
            this.emit(JobStatus.Success, { file: this.outputFile });
          });

          this.ffmpeg.stderr.on('data', (data) => {
            data = data.toString();

            if (this.#handle('ffmpeg::out', data, /error[:|\]]/im.test(data))) {
              return;
            }

            const timeString = data.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (timeString) {
              const timeSeconds =
                parseInt(timeString[1], 10) * 3600 +
                parseInt(timeString[2], 10) * 60 +
                parseFloat(timeString[3]);
              const progress = Math.min(Math.round((timeSeconds / durationSeconds) * 100), 100);

              this.emit(JobStatus.Progress, { percent: progress });
            }
          });
        });
      });
  }
}
