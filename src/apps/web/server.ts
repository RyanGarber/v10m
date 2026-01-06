import fs from 'fs';
import ejs from 'ejs';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { randomBytes } from 'node:crypto';

import { WEB_DEFAULT_DOWNLOAD_FILENAME, WEB_TARGET_SIZE_LIST } from '../../consts.js';
import { ConfigManager, type PartialConfig } from '../../config.js';
import { YTdlpJob, FFmpegJob, JobStatus } from '../../jobs/index.js';
import { WorkerManager } from '../../workers/index.js';

/**
 * Public-facing worker state
 */
export interface WorkerState {
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
export class Server {
  configs: ConfigManager;
  workers: WorkerManager;
  workerStates: Map<bigint, WorkerState>;
  fastify: fastify.FastifyInstance;

  constructor(configOverrides: PartialConfig = {}) {
    this.configs = new ConfigManager(configOverrides);

    console.log('Starting server with config:', this.configs.config);
    this.workers = new WorkerManager(this.configs);
    this.workerStates = new Map<bigint, WorkerState>();

    this.fastify = fastify({
      logger: true,
      routerOptions: {
        ignoreTrailingSlash: true,
        ignoreDuplicateSlashes: true,
      },
    });

    this.fastify.register(fastifyCookie);

    this.fastify.setErrorHandler((error, request, reply) => {
      console.error(error);
      reply.status(500).send({ status: 'error', details: 'Internal Server Error' });
    });

    this.fastify.get(`${this.configs.config.web.root}/`, async (request, reply) => {
      reply.header('Content-Type', 'text/html');
      return ejs.renderFile('src/apps/web/views/index.ejs', { targetSizes: WEB_TARGET_SIZE_LIST });
    });

    this.fastify.post(`${this.configs.config.web.root}/download`, async (request, reply) => {
      const body = request.body as any; // TODO fix typing -- extend YTdlpJobOptions?

      const downloadOutput = randomBytes(16).toString('hex') + '.mp4';
      const transcodeOutput = randomBytes(16).toString('hex') + '.mp4';

      const targetSize = !isNaN(parseInt(body.targetSize, 10))
        ? parseInt(body.targetSize, 10)
        : undefined;
      const maxTargetSize = WEB_TARGET_SIZE_LIST[WEB_TARGET_SIZE_LIST.length - 1];
      if (!targetSize || targetSize <= 0 || targetSize > maxTargetSize) {
        return reply
          .code(400)
          .send({ status: 'error', details: `Size must be between 1 and ${maxTargetSize}` });
      }

      console.log(`Received download request: ${body.url}, target size: ${targetSize} MB`);
      const jobs = [
        new YTdlpJob(body.url, `/tmp/${downloadOutput}`, {
          ...body,
          debug: this.configs.config.debug,
        }),
        new FFmpegJob(`/tmp/${downloadOutput}`, `/tmp/${transcodeOutput}`, {
          fileSizeKilobytes: targetSize ? targetSize * 1024 : undefined,
          debug: this.configs.config.debug,
        }),
      ];

      const id = this.workers.createWorker(jobs, (job: number, status: JobStatus, data: any) => {
        console.log(`Worker: ${id}, job: ${typeof job}, status: ${status}`, data);
        if (job === 1 && status === JobStatus.Success) {
          const url = `${request.protocol}://${request.headers.host}${request.url}/${id}/${WEB_DEFAULT_DOWNLOAD_FILENAME}.mp4`;
          this.workerStates.set(id, {
            id: id.toString(),
            status: 'finished',
            tempFile: transcodeOutput,
            downloadFile: url,
          });
        } else if (status === JobStatus.Progress) {
          const totalProgress = (job === 1 ? 50 : 0) + data.percent / 2;
          this.workerStates.set(id, {
            id: id.toString(),
            status: 'working',
            progress: totalProgress,
          });
        } else if (status === JobStatus.Failure) {
          this.workerStates.set(id, {
            id: id.toString(),
            status: 'failed',
            error: data,
          });
        }
      });

      this.workerStates.set(id, {
        id: id.toString(),
        status: 'waiting',
        at: this.workers.getWorkersWaiting(),
      });

      return this.workerStates.get(id);
    });

    this.fastify.get(`${this.configs.config.web.root}/download/:id`, async (request, reply) => {
      const params = request.params as any; // TODO fix typing
      const workerState = this.workerStates.get(BigInt(params.id));
      if (!workerState) {
        return reply.code(404).send({ status: 'error', details: 'Job not found' });
      }

      if (workerState.status === 'waiting') {
        workerState.at = this.workers.getWorkerPositionWaiting(workerState.id) + 1;
      }
      return workerState;
    });

    this.fastify.get(
      `${this.configs.config.web.root}/download/:id/:filename`,
      async (request, reply) => {
        const params = request.params as any; // TODO fix typing
        const workerState = this.workerStates.get(BigInt(params.id));
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
  }

  start() {
    const config = this.configs.config;
    void this.fastify.listen({
      host: config.web.host,
      port: config.web.port,
    });
  }
}
