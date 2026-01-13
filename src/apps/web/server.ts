import fs from 'fs';
import ejs from 'ejs';
import url from 'url';
import path from 'path';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { fileTypeFromFile, fileTypeStream } from 'file-type';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import killPort from 'kill-port';

import { ConfigManager, type PartialConfig } from '../../config.js';
import { YTdlpJob, FFmpegJob } from '../../jobs/index.js';
import { WorkerManager } from '../../workers/index.js';
import pkg from '../../../package.json' with { type: 'json' };
import { WEB_UPLOAD_CLEANUP_MS } from '../../consts.js';
import sanitize from 'sanitize-filename';
import { type ProcessStatus } from './schema.js';

/**
 * v10m web server
 */
export class WebServer {
  configManager: ConfigManager;
  workers: WorkerManager;
  statuses: Map<bigint, ProcessStatus>;
  fastify: fastify.FastifyInstance;

  constructor(configOverrides: PartialConfig = {}) {
    this.configManager = new ConfigManager(configOverrides);

    console.log('Starting server with config:', this.configManager.config);
    this.workers = new WorkerManager(this.configManager);
    this.statuses = new Map<bigint, ProcessStatus>();

    this.fastify = fastify({
      routerOptions: {
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
      bodyLimit: this.configManager.config.web.maxFileSizeMb * 1024 * 1024,
    });

    this.fastify.register(fastifyCookie);
    this.fastify.register(fastifyMultipart);

    this.fastify.addHook('onSend', async (request, reply, payload) => {
      reply.header('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      reply.header('access-control-allow-origin', '*');
      return payload;
    });

    this.fastify.setErrorHandler((error, request, reply) => {
      console.trace(error);
      reply.status(500).send({ status: 'error', details: 'Internal Server Error' });
    });

    this.fastify.get(`${this.configManager.config.web.path}/`, async (request, reply) => {
      reply.header('Content-Type', 'text/html');
      return ejs.renderFile(
        path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'views/app.ejs'),
        {
          version: pkg.version,
          description: pkg.description,
          url: this.configManager.config.web.url,
          targetSizes: this.configManager.config.web.targetSizeListMb,
        }
      );
    });

    this.fastify.post(`${this.configManager.config.web.path}/process`, async (request, reply) => {
      const downloadOutput = randomBytes(16).toString('hex') + '.mp4';
      const transcodeOutput = randomBytes(16).toString('hex') + '.mp4';

      const body: Record<string, string> = {};
      const parts = request.parts();

      let upload = null;
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file' || upload) {
            continue;
          }
          if (body.url) {
            return reply.code(400).send({
              status: 'error',
              details: 'Cannot use both file and URL',
            } satisfies ProcessStatus);
          }

          console.log(`File being uploaded: ${part.filename}`);
          const writeStream = fs.createWriteStream(`/tmp/${downloadOutput}`);
          setTimeout(() => {
            writeStream.destroy(new Error('Upload timed out'));
            if (fs.existsSync(`/tmp/${downloadOutput}`)) {
              fs.unlinkSync(`/tmp/${downloadOutput}`);
            }
          }, WEB_UPLOAD_CLEANUP_MS);

          const typeStream = await fileTypeStream(part.file);
          if (!typeStream.fileType?.mime.startsWith('video/')) {
            part.file.resume(); // Drain the stream
            return reply
              .code(400)
              .send({ status: 'error', details: 'Not a valid video file' } satisfies ProcessStatus);
          }

          try {
            await pipeline(typeStream, writeStream);
          } catch (error) {
            console.error('Error writing uploaded file:', error);
            return reply
              .code(500)
              .send({ status: 'error', details: 'Failed to upload file' } satisfies ProcessStatus);
          }

          upload = part.filename;
        } else {
          body[part.fieldname] = part.value as string;
        }
      }

      if (!upload) {
        try {
          const parsed = new URL(body.url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('URL must be http or https');
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          return reply
            .code(400)
            .send({ status: 'error', details: 'Not a valid URL' } satisfies ProcessStatus);
        }
      }

      const targetSize = !isNaN(parseInt(body.targetSize, 10))
        ? parseInt(body.targetSize, 10)
        : undefined;

      const maxTargetSize =
        this.configManager.config.web.targetSizeListMb[
          this.configManager.config.web.targetSizeListMb.length - 1
        ];

      if (!targetSize || targetSize <= 0 || targetSize > maxTargetSize) {
        return reply
          .code(400)
          .send({ status: 'error', details: `Not a valid target size` } satisfies ProcessStatus);
      }

      console.log(
        `Received download request: ${upload ?? body.url}, target size: ${targetSize} MB`
      );

      const id = this.workers.addWorkerToQueue({
        jobs: [
          ...(!upload
            ? [
                new YTdlpJob(body.url, `/tmp/${downloadOutput}`, {
                  ...body,
                  debug: this.configManager.config.debug,
                }),
              ]
            : []),
          new FFmpegJob(`/tmp/${downloadOutput}`, `/tmp/${transcodeOutput}`, {
            targetSizeKb: targetSize ? targetSize * 1024 : undefined,
            debug: this.configManager.config.debug,
          }),
        ],
        onFinished: () => {
          const worker = this.workers.getWorker(id);
          if (worker) {
            const filename = sanitize(
              upload
                ? `${upload.slice(0, upload.lastIndexOf('.'))}.v10m.mp4`
                : worker.getFirstJobOfType(YTdlpJob)!.title
            );
            const downloadUrl = `${this.configManager.config.web.url}/process/${id}/${filename}.mp4`;
            this.statuses.set(id, {
              status: 'finished',
              id: id.toString(),
              filename: filename,
              download: downloadUrl,
            });
          }
        },
        onFailed: (jobIndex, error) => {
          const worker = this.workers.getWorker(id);
          if (worker) {
            this.statuses.set(id, {
              status: 'failed',
              id: id.toString(),
              details: `Job ${jobIndex} failed: ${error.message.trim()}`,
            });
          }
        },
        onProgress: (jobIndex, percent) => {
          const worker = this.workers.getWorker(id);
          if (worker) {
            this.statuses.set(id, {
              status: 'working',
              id: id.toString(),
              progress: (100 / worker.jobs.length) * jobIndex + percent / worker.jobs.length,
            });
          }
        },
      });

      this.statuses.set(id, {
        status: 'waiting',
        id: id.toString(),
        at: this.workers.getWorkersWaiting(),
      });

      return this.statuses.get(id);
    });

    this.fastify.get(
      `${this.configManager.config.web.path}/process/:id`,
      async (request, reply) => {
        const params = request.params as { id: string };
        const processState = this.statuses.get(SafeBigInt(params.id));
        if (!processState) {
          return reply
            .code(404)
            .send({ status: 'error', details: 'Job not found' } satisfies ProcessStatus);
        }

        if (processState.status === 'waiting') {
          processState.at = this.workers.getWorkerPositionWaiting(processState.id) + 1;
        }
        return processState;
      }
    );

    this.fastify.get(
      `${this.configManager.config.web.path}/process/:id/:filename`,
      async (request, reply) => {
        const params = request.params as { id: string; filename: string };
        const processState = this.statuses.get(SafeBigInt(params.id));
        if (!processState) {
          return reply
            .code(404)
            .send({ status: 'error', details: 'Job not found' } satisfies ProcessStatus);
        }
        if (processState.status !== 'finished') {
          return reply
            .code(404)
            .send({ status: 'error', details: 'Job not finished' } satisfies ProcessStatus);
        }

        const ffmpegOutput = this.workers.getWorker(params.id)!.getFirstJobOfType(FFmpegJob)!
          .files[0];
        const stream = fs.createReadStream(ffmpegOutput);
        reply.header('Content-Disposition', `attachment; filename="${processState.filename}"`);
        reply.type('video/mp4');
        return reply.send(stream);
      }
    );

    const __filename = url.fileURLToPath(import.meta.url);
    const staticDirs = [
      path.join(path.dirname(__filename), 'static'),
      ...(path.extname(__filename) === '.ts'
        ? [path.join(path.dirname(__filename), '../../../dist/apps/web/static')]
        : []),
    ];
    this.fastify.get(`${this.configManager.config.web.path}/*`, async (request, reply) => {
      const file = (request.params as { '*': string })['*'];
      for (const staticDir of staticDirs) {
        const filePath = path.join(staticDir, file);
        if (fs.existsSync(filePath)) {
          const stream = fs.createReadStream(filePath);
          const binaryType = await fileTypeFromFile(filePath);
          const textTypes = new Map<string, string>([
            ['.js', 'application/javascript'],
            ['.css', 'text/css'],
            ['.xml', 'application/xml'],
            ['.html', 'text/html'],
            ['.json', 'application/json'],
          ]);
          reply.type(
            binaryType?.mime ?? textTypes.get(path.extname(file)) ?? 'application/octet-stream'
          );
          return reply.send(stream);
        }
      }
      return reply
        .code(404)
        .send({ status: 'error', details: 'Page not found' } satisfies ProcessStatus);
    });
  }

  async start() {
    if (process.env.V10M_KILL_PORT === 'true') {
      try {
        await (killPort as (port: number) => Promise<void>)(this.configManager.config.web.port);
        console.log(`Taking port ${this.configManager.config.web.port}...`);
      } catch {
        // Ignore
      }
    }
    await this.fastify.listen({
      host: this.configManager.config.web.host,
      port: this.configManager.config.web.port,
    });
  }
}

function SafeBigInt(value: string | number | bigint | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}
