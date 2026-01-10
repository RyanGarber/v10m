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
import type { JobStatusData } from '../../jobs/index.js';
import { YTdlpJob, FFmpegJob, JobStatus } from '../../jobs/index.js';
import { WorkerManager } from '../../workers/index.js';
import pkg from '../../../package.json' with { type: 'json' };
import { WEB_UPLOAD_CLEANUP_MS } from '../../consts.js';

/**
 * Process state (returned verbatim to user)
 */
export interface ProcessState {
  id: string;
  status: 'waiting' | 'working' | 'finished' | 'failed';
  progress?: number;
  filename?: string;
  downloadUrl?: string;
  at?: number;
  details?: string;
}

/**
 * v10m web server
 */
export class WebServer {
  configs: ConfigManager;
  processWorkers: WorkerManager;
  processStates: Map<bigint, ProcessState>;
  fastify: fastify.FastifyInstance;

  constructor(configOverrides: PartialConfig = {}) {
    this.configs = new ConfigManager(configOverrides);

    console.log('Starting server with config:', this.configs.config);
    this.processWorkers = new WorkerManager(this.configs);
    this.processStates = new Map<bigint, ProcessState>();

    this.fastify = fastify({
      logger: this.configs.config.debug ? { level: 'debug' } : false,
      routerOptions: {
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
      bodyLimit: this.configs.config.web.maxUploadSizeMb * 1024 * 1024,
    });

    this.fastify.register(fastifyCookie);
    this.fastify.register(fastifyMultipart);

    this.fastify.setErrorHandler((error, request, reply) => {
      console.trace(error);
      reply.status(500).send({ status: 'error', details: 'Internal Server Error' });
    });

    this.fastify.get(`${this.configs.config.web.path}/`, async (request, reply) => {
      reply.header('Content-Type', 'text/html');
      return ejs.renderFile(
        path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'views/index.ejs'),
        {
          version: pkg.version,
          description: pkg.description,
          url: this.configs.config.web.url,
          targetSizes: this.configs.config.web.targetSizeListMb,
        }
      );
    });

    this.fastify.post(`${this.configs.config.web.path}/process`, async (request, reply) => {
      const downloadOutput = randomBytes(16).toString('hex') + '.mp4';
      const transcodeOutput = randomBytes(16).toString('hex') + '.mp4';

      const body: Record<string, string> = {};
      const parts = request.parts();

      let useFile = false;
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file' || useFile) {
            continue;
          }
          if (body.url) {
            return reply
              .code(400)
              .send({ status: 'error', details: 'Cannot use both file and URL' });
          }
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
          await pipeline(typeStream, writeStream).catch((error) => {
            console.error('Error writing uploaded file:', error);
            return reply.code(500).send({ status: 'error', details: 'Failed to upload file' });
            // TODO execution doesn't stop here?
          });
          useFile = true;
        } else {
          body[part.fieldname] = part.value as string;
        }
      }

      if (!useFile) {
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
        this.configs.config.web.targetSizeListMb[
          this.configs.config.web.targetSizeListMb.length - 1
        ];
      if (!targetSize || targetSize <= 0 || targetSize > maxTargetSize) {
        return reply.code(400).send({ status: 'error', details: `Not a valid target size` });
      }

      console.log(
        `Received download request: ${useFile ? `file:///tmp/${downloadOutput}` : body.url}, target size: ${targetSize} MB`
      );
      const jobs = [];
      if (!useFile) {
        jobs.push(
          new YTdlpJob(body.url, `/tmp/${downloadOutput}`, {
            ...body,
            debug: this.configs.config.debug,
          })
        );
      }
      jobs.push(
        new FFmpegJob(`/tmp/${downloadOutput}`, `/tmp/${transcodeOutput}`, {
          targetSizeKb: targetSize ? targetSize * 1024 : undefined,
          debug: this.configs.config.debug,
        })
      );

      const id = this.processWorkers.addWorkerToQueue(jobs, (job: number, data: JobStatusData) => {
        console.log(`Worker: ${id}, job: ${typeof job}, data:`, data);
        if (job === jobs.length - 1 && data.status === JobStatus.Success) {
          const downloadUrl = `${this.configs.config.web.url}/process/${id}/${this.configs.config.web.defaultDownloadFilename}.mp4`;
          this.processStates.set(id, {
            id: id.toString(),
            status: 'finished',
            filename: transcodeOutput,
            downloadUrl: downloadUrl,
          });
        } else if (data.status === JobStatus.Progress) {
          const totalProgress = (100 / jobs.length) * job + data.percent / jobs.length;
          this.processStates.set(id, {
            id: id.toString(),
            status: 'working',
            progress: totalProgress,
          });
        } else if (data.status === JobStatus.Failure) {
          this.processStates.set(id, {
            id: id.toString(),
            status: 'failed',
            details: data.message,
          });
        }
      });

      this.processStates.set(id, {
        id: id.toString(),
        status: 'waiting',
        at: this.processWorkers.getWorkersWaiting(),
      });

      return this.processStates.get(id);
    });

    this.fastify.get(`${this.configs.config.web.path}/process/:id`, async (request, reply) => {
      const params = request.params as { id: string };
      const processState = this.processStates.get(SafeBigInt(params.id));
      if (!processState) {
        return reply.code(404).send({ status: 'error', details: 'Job not found' });
      }

      if (processState.status === 'waiting') {
        processState.at = this.processWorkers.getWorkerPositionWaiting(processState.id) + 1;
      }
      return processState;
    });

    this.fastify.get(
      `${this.configs.config.web.path}/process/:id/:filename`,
      async (request, reply) => {
        const params = request.params as { id: string; filename: string };
        const processState = this.processStates.get(SafeBigInt(params.id));
        if (!processState) {
          return reply.code(404).send({ status: 'error', details: 'Job not found' });
        }
        if (processState.status !== 'finished') {
          return reply.code(404).send({ status: 'error', details: 'Job not finished' });
        }

        const stream = fs.createReadStream(`/tmp/${processState.filename}`);
        reply.header('Content-Disposition', `attachment; filename="${params.filename}"`);
        reply.type('video/mp4');
        return reply.send(stream);
      }
    );

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    for (const file of fs.readdirSync(path.join(__dirname, 'static'))) {
      this.fastify.get(`${this.configs.config.web.path}/${file}`, async (request, reply) => {
        const stream = fs.createReadStream(path.join(__dirname, 'static', file));
        const type = await fileTypeFromFile(path.join(__dirname, 'static', file));
        reply.type(type?.mime ?? 'application/octet-stream');
        return reply.send(stream);
      });
    }
  }

  start() {
    void this.fastify.listen({
      host: this.configs.config.web.host,
      port: this.configs.config.web.port,
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
