import { Snowyflake } from 'snowyflake';
import { Job, JobStatus } from '../jobs/index.js';
import { type Worker, WorkerList } from './list.js';
import { ConfigManager } from '../config.js';

/**
 * Main services class.
 */
export class WorkerManager {
    private workers: WorkerList;
    private snowyflake: Snowyflake;
    private configManager: ConfigManager;

    constructor(configManager: ConfigManager) {
        this.workers = new WorkerList();
        this.snowyflake = new Snowyflake();
        this.configManager = configManager;
    }

    createWorker(jobs: Job[], callback?: (job: number, status: JobStatus, data: any) => void) {
        const worker: Worker = {
            jobs: jobs,
            working: false,
        };

        worker.jobs.forEach((job, index) => {
            job.on(JobStatus.Success, (data) => {
                if (index < worker.jobs.length - 1) worker.jobs[index + 1].start();
                else worker.working = false;
            });

            // TODO combine statuses here and return overall progress?
            for (const status of Object.values(JobStatus)) {
                job.on(status, (data) => callback && callback(index, status, data));
            }
        });

        const id = this.snowyflake.nextId();
        this.workers.add(id, worker);
        this.workers.setWaiting(id);
        return id;
    }

    getWorkersWaiting() {
        return this.workers.getCountWaiting();
    }

    getWorkerPositionWaiting(id: bigint|string) {
        return this.workers.findPositionWaiting(id);
    }
    test() { console.log(this.configManager.config.workers.max); }

    start() {
        setInterval(() => {
            console.log(`Processing queue (${this.workers.getCountTotal()} total, ${this.workers.getCountWaiting()} waiting)...`);
            let next;
            if (this.workers.getCountWorking() < this.configManager.config.workers.max && this.workers.getCountWaiting() > 0) {
                if (next = this.workers.getNextWaiting()) {
                    console.log(`Starting job ${next.id}...`);
                    next.item.jobs[0].start();
                    next.item.working = true;
                }
            }
        }, this.configManager.config.workers.loopMs);
    }
}