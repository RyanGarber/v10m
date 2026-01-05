#!/usr/bin/env node
import fs from 'fs';
import ejs from 'ejs';
import fastify from 'fastify';
import { Command } from 'commander';
import fastifyCookie from '@fastify/cookie';

import { ConfigManager, type PartialConfig } from '../../config.js';
import { WorkerManager } from '../../workers/index.js';
import { YTdlpJob, FFmpegJob, JobStatus } from '../../jobs/index.js';
import { randomBytes } from 'node:crypto';

export class Server {
    configs: ConfigManager;
    workers: WorkerManager;
    workerStates: Map<bigint, any>;
    fastify: fastify.FastifyInstance;


    constructor(configOverrides: PartialConfig = {}) {
        this.configs = new ConfigManager(configOverrides);
        
        console.log('Starting server with config:', this.configs.config);
        this.workers = new WorkerManager(this.configs);
        this.workerStates = new Map<bigint, any>();

        this.fastify = fastify({
            logger: true,
            routerOptions: {
                ignoreTrailingSlash: true,
                ignoreDuplicateSlashes: true,
            }
        });

        this.fastify.register(fastifyCookie);

        this.fastify.setErrorHandler((error, request, reply) => {
            console.error(error); debugger;
            reply.status(500).send({ status: 'error', details: 'Internal Server Error' });
        });

        this.fastify.get(`${this.configs.config.web.root}/`, async (request, reply) => {
            reply.header('Content-Type', 'text/html');
            return ejs.renderFile('src/apps/web/views/index.ejs');
        });

        this.fastify.post(`${this.configs.config.web.root}/download`, async (request, reply) => {
            const body = request.body as any; // TODO fix typing
            const downloaded = randomBytes(16).toString('hex') + '.mp4';
            const transcoded = randomBytes(16).toString('hex') + '.mp4';

            const jobs = [
                new YTdlpJob(body.url, downloaded, { ...body, debug: this.configs.config.debug }),
                new FFmpegJob(downloaded, transcoded, { fileSizeKilobytes: 1024 * 10, debug: this.configs.config.debug })
            ];

            const id = this.workers.createWorker(jobs, (job: number, status: JobStatus, data: any) => {
                console.log(`Worker: ${id}, job: ${typeof job}, status: ${status}`, data);
                if (job === 1 && status === JobStatus.Success) {
                    const url = `${request.protocol}://${request.headers.host}${request.url}/${id}/${transcoded}`;
                    this.workerStates.set(id, { id: id, status: 'finished', filename: transcoded, download: url });
                }
                else if (status === JobStatus.Progress) {
                    const totalProgress = (job === 1 ? 50 : 0) + (data.percent / 2);
                    this.workerStates.set(id, { id: id, status: 'working', progress: totalProgress });
                }
                else if (status === JobStatus.Failure) {
                    this.workerStates.set(id, { id: id, status: 'failed', error: data });
                }
            });

            this.workerStates.set(id, { id: id, status: 'waiting', at: this.workers.getWorkersWaiting() });
            return this.workerStates.get(id);
        });

        this.fastify.get(`${this.configs.config.web.root}/download/:id`, async (request, reply) => {
            const params = request.params as any; // TODO fix typing
            const workerState = this.workerStates.get(params.id);
            if (!workerState) return reply.code(404).send({ status: 'error', details: 'Job not found' });

            if (workerState.info.status === 'waiting') workerState.info.at = this.workers.getWorkerPositionWaiting(workerState.info.id) + 1;
            return workerState.info;
        });

        this.fastify.get(`${this.configs.config.web.root}/download/:id/:file`, async (request, reply) => {
            const params = request.params as any; // TODO fix typing
            const workerState = this.workerStates.get(params.id);
            if (!workerState) return reply.code(404).send({ status: 'error', details: 'Job not found' });
            if (workerState.info.status !== 'finished') return reply.code(404).send({ status: 'error', details: 'Job not finished' });

            const stream = fs.createReadStream(`/tmp/${workerState.filename}`);
            reply.header('Content-Disposition', `attachment; filename="${params.file}"`);
            reply.type('video/mp4');
            reply.send(stream);
        });
    }

    start() {
        const config = this.configs.config;
        this.fastify.listen({ 
            host: config.web.host, 
            port: config.web.port 
        });
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const program = new Command();
    
    program
        .option('--debug', 'enable debug mode')
        .option('--workers <number>', 'maximum number of workers', parseInt)
        .option('--workers-loop <ms>', 'worker loop interval in ms', parseInt)
        .option('-h, --host <host>', 'server host')
        .option('-p, --port <port>', 'server port', parseInt)
        .action((options) => {
            const overrides: PartialConfig = {};
            
            if (options.debug) overrides.debug = true;
            if (options.workers) overrides.workers = { max: options.workers };
            if (options.workersLoop) overrides.workers = { ...overrides.workers, loopMs: options.workersLoop };

            if (options.host || options.port) {
                overrides.web = { host: options.host, port: options.port };
            }
            
            const server = new Server(overrides);
            server.start();
            server.workers.start();
        });
    
    program.parse();
}