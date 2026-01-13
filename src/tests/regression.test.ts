import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import * as cp from 'child_process';
import fs from 'fs'; // This will be the REAL fs because we don't mock it at top level (or we shouldn't if we want to write files)
import path from 'path';

// -- Mock Setup --

// We define the mock factory for child_process
vi.mock('child_process', () => {
  const spawnMock = vi.fn().mockImplementation((command: string, args: string[]) => {
    // Return a fake ChildProcess
    const process = new (class extends require('events').EventEmitter {
      stdout = new (require('events').EventEmitter)();
      stderr = new (require('events').EventEmitter)();
      kill = vi.fn();
    })();

    setTimeout(() => {
      // Simulate File Writing for yt-dlp and ffmpeg
      if (command === 'yt-dlp' || command === 'ffmpeg') {
        let outputFile: string | undefined;

        if (command === 'yt-dlp') {
          const oIdx = args.indexOf('-o');
          if (oIdx > -1) outputFile = args[oIdx + 1];
        } else if (command === 'ffmpeg') {
          outputFile = args[args.length - 1];
        }

        if (outputFile) {
          try {
            const fs = require('fs');
            const path = require('path');
            const dir = path.dirname(outputFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(outputFile, 'dummy-video-content');
          } catch (e) {
            // ignore
          }
        }
      }

      // Simulate ffprobe output
      if (command === 'ffprobe') {
        process.stderr.emit('data', 'Duration: 00:00:10.00');
      }

      process.emit('close', 0);
    }, 10);

    return process;
  });

  return {
    spawn: spawnMock,
    default: { spawn: spawnMock },
  };
});

// Import jobs AFTER mocks are set up (automatically handled by vitest hoisting, but good practice)
import { YTdlpJob } from '../jobs/ytdlp.js';
import { FFmpegJob } from '../jobs/ffmpeg.js';

describe('Regression Suite', () => {
  const TEST_OUTPUT_DIR = '/tmp/v10m-regression';

  beforeAll(() => {
    if (!fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.mkdirSync(TEST_OUTPUT_DIR);
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Black Box Guard (Golden Master)', () => {
    it('yt-dlp arguments MUST match Golden Master', async () => {
      const outputUrl = path.join(TEST_OUTPUT_DIR, 'ytdlp_out.mp4');
      const job = new YTdlpJob('http://test.com/video', outputUrl);
      await job.run();

      // Access spy via imported module
      const spawnMock = vi.mocked(cp.spawn);
      const call = spawnMock.mock.calls.find((c) => c[0] === 'yt-dlp');

      expect(call).toBeDefined();
      const args = call![1] as string[];

      // The mock factory for spawn creates a process that emits 'close' with 0.
      // So `hasNvidia` is true.
      const expectedArgs = [
        '-o',
        outputUrl,
        '-f',
        'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
        '--js-runtime=node',
        '--print',
        'video:title=%(title)s',
        '--no-simulate',
        '--progress',
        '--newline',
        '--postprocessor-args',
        'ffmpeg_i:-hwaccel cuda -hwaccel_output_format cuda -extra_hw_frames 8',
        '--postprocessor-args',
        'ffmpeg_o:-c:v h264_nvenc',
        'http://test.com/video',
      ];

      expect(args).toEqual(expectedArgs);
    });

    it('ffmpeg arguments MUST match Golden Master', async () => {
      const inputUrl = path.join(TEST_OUTPUT_DIR, 'input.mp4');
      const outputUrl = path.join(TEST_OUTPUT_DIR, 'ffmpeg_out.mp4');
      fs.writeFileSync(inputUrl, 'dummy');

      const job = new FFmpegJob(inputUrl, outputUrl);

      await job.run();

      const spawnMock = vi.mocked(cp.spawn);
      const call = spawnMock.mock.calls.find((c) => c[0] === 'ffmpeg');
      expect(call).toBeDefined();
      const args = call![1] as string[];

      const expectedArgs = [
        '-hwaccel',
        'cuda',
        '-hwaccel_output_format',
        'cuda',
        '-extra_hw_frames',
        '8',
        '-i',
        inputUrl,
        '-progress',
        'pipe:2',
        '-c:v',
        'h264_nvenc',
        '-b:v',
        '100k',
        '-b:a',
        '128k',
        '-y',
        outputUrl,
      ];

      expect(args).toEqual(expectedArgs);
    });
  });

  describe('Contract Enforcement', () => {
    it('Pipeline should produce a non-zero byte video file', async () => {
      const fileOutput = path.join(TEST_OUTPUT_DIR, 'contract_test.mp4');
      const job = new YTdlpJob('https://example.com', fileOutput);

      await job.run();

      expect(fs.existsSync(fileOutput)).toBe(true);
      const stats = fs.statSync(fileOutput);
      expect(stats.size).toBeGreaterThan(0);
    });
  });
});
