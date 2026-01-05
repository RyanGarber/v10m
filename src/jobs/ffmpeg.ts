import fs from "fs";
import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { Job, JobStatus } from "./base-job.js";

/**
 * FFmpeg job options
 */
export interface FFmpegJobOptions {
  fileSizeKilobytes?: number;
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

  constructor(
    inputFile: string,
    outputFile: string,
    options: FFmpegJobOptions = {},
  ) {
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
        console.log("----- FAILURE - WOULD EXIT HERE -----");
      }
    } else if (isError) {
      try {
        this.ffmpeg!.kill();
      } catch (e: any) {
        console.log(
          `[${scope}] Failed to kill ffmpeg process: ${e.toString()}`,
        );
      }
      if (fs.existsSync(`${this.outputFile}`)) {
        fs.unlinkSync(`${this.outputFile}`);
      }
      this.emit(JobStatus.Failure, `[${scope}] ${data.toString()}`);
      return true;
    }

    return false;
  }

  start() {
    console.log(
      `Starting transcode from ${this.inputFile} to ${this.outputFile}`,
    );
    this.emit(JobStatus.Progress, { percent: 0 });

    // Prepare ffmpeg arguments
    const ffmpegArgs = [
      "-i",
      this.inputFile,
      "-f",
      "mp4",
      "-movflags",
      "faststart",
      "-progress",
      "pipe:2",
      this.outputFile,
    ];

    // Start ffmpeg process
    this.ffmpeg = spawn("ffmpeg", ffmpegArgs);

    this.ffmpeg.on("error", (error) => {
      if (this.#handle("ffmpeg::error", error, true)) {
        return;
      }
    });

    this.ffmpeg.on("close", (code) => {
      if (this.#handle("ffmpeg::close", code, code !== 0)) {
        return;
      }
      this.emit(JobStatus.Success, { file: this.outputFile });
    });

    let duration: number | null = null;

    this.ffmpeg.stderr.on("data", (data) => {
      data = data.toString();

      if (this.#handle("ffmpeg::out", data, /error[:|\]]/im.test(data))) {
        return;
      }

      const durationMatch = data.match(
        /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/,
      );
      if (durationMatch && !duration) {
        const hours = parseInt(durationMatch[1]);
        const minutes = parseInt(durationMatch[2]);
        const seconds = parseFloat(durationMatch[3]);

        duration = hours * 3600 + minutes * 60 + seconds;
      }

      const timeMatch = data.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
      if (timeMatch && duration) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const seconds = parseFloat(timeMatch[3]);
        const currentTime = hours * 3600 + minutes * 60 + seconds;
        const progress = Math.min(
          Math.round((currentTime / duration) * 100),
          100,
        );

        this.emit(JobStatus.Progress, { percent: progress });
      }
    });
  }
}
