import fs from 'fs';
import ejs from 'ejs';
import url from 'url';
import path from 'path';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { fileTypeStream } from 'file-type';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import { ConfigManager, type PartialConfig } from '../../config.js';
import { YTdlpJob, FFmpegJob, JobStatus } from '../../jobs/index.js';
import { WorkerManager } from '../../workers/index.js';
import pkg from '../../../package.json' with { type: 'json' };
import { WEB_UPLOAD_CLEANUP_MS } from '../../consts.js';

/**
 * Public-facing worker state
 */
export interface WebWorkerState {
  id: string;
  status: 'waiting' | 'working' | 'finished' | 'failed';
  progress?: number;
  tempFile?: string;
  downloadFile?: string;
  at?: number;
  error?: any;
}

/**
 * v10m web server
 */
export class WebServer {
  configs: ConfigManager;
  processWorkers: WorkerManager;
  processStates: Map<bigint, WebWorkerState>;
  fastify: fastify.FastifyInstance;

  constructor(configOverrides: PartialConfig = {}) {
    this.configs = new ConfigManager(configOverrides);

    console.log('Starting server with config:', this.configs.config);
    this.processWorkers = new WorkerManager(this.configs);
    this.processStates = new Map<bigint, WebWorkerState>();

    this.fastify = fastify({
      logger: true,
      routerOptions: {
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
      bodyLimit: this.configs.config.web.maxUploadSizeMb * 1024 * 1024,
    });

    this.fastify.register(fastifyCookie);
    this.fastify.register(fastifyMultipart);

    this.fastify.setErrorHandler((error, request, reply) => {
      console.error(error);
      reply.status(500).send({ status: 'error', details: 'Internal Server Error' });
    });

    this.fastify.get(`${this.configs.config.web.path}/`, async (request, reply) => {
      reply.header('Content-Type', 'text/html');
      return ejs.renderFile('src/apps/web/views/index.ejs', {
        version: pkg.version,
        url: this.configs.config.web.url,
        targetSizes: this.configs.config.web.targetSizeListMb,
      });
    });

    this.fastify.post(`${this.configs.config.web.path}/process`, async (request, reply) => {
      const downloadOutput = randomBytes(16).toString('hex') + '.mp4';
      const transcodeOutput = randomBytes(16).toString('hex') + '.mp4';
      
      const body: any = {};
      const parts = request.parts();

      let useFile = false;
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file' || useFile) {
            continue;
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
          body[part.fieldname] = part.value;
        }
      }

      if (!useFile && (!body.url || typeof body.url !== 'string')) {
        return reply.code(400).send({ status: 'error', details: 'Not a valid URL' });
      }

      const targetSize = !isNaN(parseInt(body.targetSize, 10)) ? parseInt(body.targetSize, 10) : undefined;
      const maxTargetSize = this.configs.config.web.targetSizeListMb[this.configs.config.web.targetSizeListMb.length - 1];
      if (!targetSize || targetSize <= 0 || targetSize > maxTargetSize) {
        return reply.code(400).send({ status: 'error', details: `Not a valid size` });
      }

      console.log(`Received download request: ${useFile ? `file:///tmp/${downloadOutput}` : body.url}, target size: ${targetSize} MB`);
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
          fileSizeKilobytes: targetSize ? targetSize * 1024 : undefined,
          debug: this.configs.config.debug,
        })
      );
      
      const id = this.processWorkers.createWorker(jobs, (job: number, status: JobStatus, data: any) => {
        console.log(`Worker: ${id}, job: ${typeof job}, status: ${status}`, data);
        if ((useFile || job === 1) && status === JobStatus.Success) {
          const downloadUrl = `${this.configs.config.web.url}/process/${id}/${this.configs.config.web.defaultDownloadFilename}.mp4`;
          this.processStates.set(id, {
            id: id.toString(),
            status: 'finished',
            tempFile: transcodeOutput,
            downloadFile: downloadUrl,
          });
        } else if (status === JobStatus.Progress) {
          const totalProgress = !useFile ? (job === 1 ? 50 : 0) + data.percent / 2 : data.percent;
          this.processStates.set(id, {
            id: id.toString(),
            status: 'working',
            progress: totalProgress,
          });
        } else if (status === JobStatus.Failure) {
          this.processStates.set(id, {
            id: id.toString(),
            status: 'failed',
            error: data,
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
      const params = request.params as any; // TODO fix typing
      const workerState = this.processStates.get(SafeBigInt(params.id));
      if (!workerState) {
        return reply.code(404).send({ status: 'error', details: 'Job not found' });
      }

      if (workerState.status === 'waiting') {
        workerState.at = this.processWorkers.getWorkerPositionWaiting(workerState.id) + 1;
      }
      return workerState;
    });

    this.fastify.get(
      `${this.configs.config.web.path}/process/:id/:filename`,
      async (request, reply) => {
        const params = request.params as any; // TODO fix typing
        const workerState = this.processStates.get(SafeBigInt(params.id));
        if (!workerState) {
          return reply.code(404).send({ status: 'error', details: 'Job not found' });
        }
        if (workerState.status !== 'finished') {
          return reply.code(404).send({ status: 'error', details: 'Job not finished' });
        }

        const stream = fs.createReadStream(`/tmp/${workerState.tempFile}`);
        reply.header('Content-Disposition', `attachment; filename="${params.filename}"`);
        reply.type('video/mp4');
        return reply.send(stream);
      }
    );

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    for (const file of fs.readdirSync(path.join(__dirname, 'static'))) {
      this.fastify.get(`${this.configs.config.web.path}/${file}`, async (request, reply) => {
        const stream = fs.createReadStream(path.join(__dirname, 'static', file));
        const types = {
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.json': 'application/json',
          '.webmanifest': 'application/manifest+json',
        };
        for (const [ext, type] of Object.entries(types)) {
          if (file.endsWith(ext)) {
            reply.type(type);
          }
        }
        return reply.send(stream);
      });
    }
  }

  start() {
    const config = this.configs.config;
    console.log('HOST: ', config.web.host);
    void this.fastify.listen({
      host: config.web.host,
      port: config.web.port,
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