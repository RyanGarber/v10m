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

import { ConfigManager, type PartialConfig } from '../../config.js';
import { YTdlpJob, FFmpegJob } from '../../jobs/index.js';
import { WorkerManager } from '../../workers/index.js';
import pkg from '../../../package.json' with { type: 'json' };
import { WEB_UPLOAD_CLEANUP_MS } from '../../consts.js';
import sanitize from 'sanitize-filename';

/**
 * Process state (returned verbatim to user)
 */
export interface ProcessState {
  id: string;
  status: 'waiting' | 'working' | 'finished' | 'failed';
  progress?: number;
  filename?: string;
  download?: string;
  at?: number;
  details?: string;
}

/**
 * v10m web server
 */
export class WebServer {
  configManager: ConfigManager;
  processWorkers: WorkerManager;
  processStates: Map<bigint, ProcessState>;
  fastify: fastify.FastifyInstance;

  constructor(configOverrides: PartialConfig = {}) {
    this.configManager = new ConfigManager(configOverrides);

    console.log('Starting server with config:', this.configManager.config);
    this.processWorkers = new WorkerManager(this.configManager);
    this.processStates = new Map<bigint, ProcessState>();

    this.fastify = fastify({
      routerOptions: {
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
      bodyLimit: this.configManager.config.web.maxUploadSizeMb * 1024 * 1024,
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
        path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'views/index.ejs'),
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
            return reply
              .code(400)
              .send({ status: 'error', details: 'Cannot use both file and URL' });
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
            return reply.code(400).send({ status: 'error', details: 'Not a valid video file' });
          }

          try {
            await pipeline(typeStream, writeStream);
          } catch (error) {
            console.error('Error writing uploaded file:', error);
            return reply.code(500).send({ status: 'error', details: 'Failed to upload file' });
          }

          upload = part.filename;
        } else {
          body[part.fieldname] = part.value as string;
        }
      }

      if (!upload) {
        try {
          new URL(body.url);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          return reply.code(400).send({ status: 'error', details: 'Not a valid URL' });
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
        return reply.code(400).send({ status: 'error', details: `Not a valid target size` });
      }

      console.log(
        `Received download request: ${upload ?? body.url}, target size: ${targetSize} MB`
      );

      const id = this.processWorkers.addWorkerToQueue({
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
          const filename = sanitize(
            upload
              ? `${upload.slice(0, upload.lastIndexOf('.'))}.v10m.mp4`
              : this.processWorkers.getWorker(id)!.getFirstJobOfType(YTdlpJob)!.title
          );
          const downloadUrl = `${this.configManager.config.web.url}/process/${id}/${filename}.mp4`;
          this.processStates.set(id, {
            id: id.toString(),
            status: 'finished',
            filename: filename,
            download: downloadUrl,
          });
        },
        onFailed: (jobIndex, error) => {
          this.processStates.set(id, {
            id: id.toString(),
            status: 'failed',
            details: `Job ${jobIndex} failed: ${error.message.trim()}`,
          });
        },
        onProgress: (jobIndex, percent) => {
          const jobCount = this.processWorkers.getWorker(id)?.jobs.length ?? -1;
          this.processStates.set(id, {
            id: id.toString(),
            status: 'working',
            ...(jobCount ? { progress: (100 / jobCount) * jobIndex + percent / jobCount } : {}),
          });
        },
      });

      this.processStates.set(id, {
        id: id.toString(),
        status: 'waiting',
        at: this.processWorkers.getWorkersWaiting(),
      });

      return this.processStates.get(id);
    });

    this.fastify.get(
      `${this.configManager.config.web.path}/process/:id`,
      async (request, reply) => {
        const params = request.params as { id: string };
        const processState = this.processStates.get(SafeBigInt(params.id));
        if (!processState) {
          return reply.code(404).send({ status: 'error', details: 'Job not found' });
        }

        if (processState.status === 'waiting') {
          processState.at = this.processWorkers.getWorkerPositionWaiting(processState.id) + 1;
        }
        return processState;
      }
    );

    this.fastify.get(
      `${this.configManager.config.web.path}/process/:id/:filename`,
      async (request, reply) => {
        const params = request.params as { id: string; filename: string };
        const processState = this.processStates.get(SafeBigInt(params.id));
        if (!processState) {
          return reply.code(404).send({ status: 'error', details: 'Job not found' });
        }
        if (processState.status !== 'finished') {
          return reply.code(404).send({ status: 'error', details: 'Job not finished' });
        }

        const ffmpegOutput = this.processWorkers.getWorker(params.id)!.getFirstJobOfType(FFmpegJob)!
          .files[0];
        const stream = fs.createReadStream(ffmpegOutput);
        reply.header('Content-Disposition', `attachment; filename="${processState.filename}"`);
        reply.type('video/mp4');
        return reply.send(stream);
      }
    );

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    for (const file of fs.readdirSync(path.join(__dirname, 'static'))) {
      this.fastify.get(`${this.configManager.config.web.path}/${file}`, async (request, reply) => {
        const stream = fs.createReadStream(path.join(__dirname, 'static', file));
        const binaryType = await fileTypeFromFile(path.join(__dirname, 'static', file));
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
      });
    }
  }

  start() {
    void this.fastify.listen({
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
