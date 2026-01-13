import { describe, it, expect, vi, beforeEach } from 'vitest';

// define mock factories that have no external references
vi.mock('child_process', () => {
  const spawnMock = vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === 'close') cb(0);
    }),
    kill: vi.fn(),
  }));
  return {
    spawn: spawnMock,
    default: {
      spawn: spawnMock,
    },
  };
});

vi.mock('fs', () => {
  const statSyncFn = vi.fn(() => ({ size: 1024 * 1024 }));
  const existsSyncFn = vi.fn(() => true);
  const writeFileSyncFn = vi.fn();
  const createReadStreamFn = vi.fn();
  const unlinkSyncFn = vi.fn();
  const readdirSyncFn = vi.fn(() => []);

  return {
    default: {
      statSync: statSyncFn,
      existsSync: existsSyncFn,
      writeFileSync: writeFileSyncFn,
      createReadStream: createReadStreamFn,
      unlinkSync: unlinkSyncFn,
      readdirSync: readdirSyncFn,
    },
    statSync: statSyncFn,
    existsSync: existsSyncFn,
    writeFileSync: writeFileSyncFn,
    createReadStream: createReadStreamFn,
    unlinkSync: unlinkSyncFn,
    readdirSync: readdirSyncFn,
  };
});

// Import code under test AFTER mocks
import { YTdlpJob } from '../jobs/ytdlp.js';
import { FFmpegJob } from '../jobs/ffmpeg.js';
import * as cp from 'child_process';

describe('Security Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Command Injection Vulnerabilities', () => {
    it('should NOT allow argument injection in YTdlpJob username', async () => {
      const job = new YTdlpJob('http://example.com', 'output.mp4', {
        username: 'user --exec "touch /tmp/pwned"',
        password: 'pass',
      });

      await job.run();

      const spawnMock = vi.mocked(cp.spawn);
      expect(spawnMock).toHaveBeenCalled();

      const calls = spawnMock.mock.calls;
      const ytdlpCall = calls.find((call) => call[0] === 'yt-dlp');

      expect(ytdlpCall).toBeDefined();
      const args = ytdlpCall![1] as string[];

      const execFlagIndex = args.indexOf('--exec');
      expect(execFlagIndex).toBe(-1);
    });

    it('should NOT allow argument injection in FFmpegJob via filename', async () => {
      const maliciousFilename = 'input.mp4; rm -rf /';
      const job = new FFmpegJob(maliciousFilename, 'output.mp4');

      await job.run();

      const spawnMock = vi.mocked(cp.spawn);
      const calls = spawnMock.mock.calls;
      const ffmpegCall = calls.find((call) => call[0] === 'ffmpeg');

      expect(ffmpegCall).toBeDefined();
      const args = ffmpegCall![1] as string[];

      const rmIndex = args.indexOf('rm');
      expect(rmIndex).toBe(-1);
    });
  });

  describe('Protocol Smuggling (SSRF)', () => {
    it('should fail if YTdlpJob is given a non-http/https URL', async () => {
      const job = new YTdlpJob('file:///etc/passwd', 'output.mp4');

      await expect(job.run()).rejects.toThrow();

      const spawnMock = vi.mocked(cp.spawn);
      const calls = spawnMock.mock.calls;
      const ytdlpCall = calls.find((call) => call[0] === 'yt-dlp');

      expect(ytdlpCall).toBeUndefined();
    });
  });
});
