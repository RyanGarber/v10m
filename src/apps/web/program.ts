import { Command } from 'commander';
import { type PartialConfig } from '../../config.js';
import { WebServer } from './index.js';

export class WebProgram {
  private program: Command;

  constructor() {
    this.program = new Command();

    this.program
      .option('--debug', 'enable debug mode')
      .option('--workers <number>', 'maximum number of workers', parseInt)
      .option('--workers-loop <ms>', 'worker loop interval in ms', parseInt)
      .option('-h, --host <host>', 'server host')
      .option('-p, --port <port>', 'server port', parseInt)
      .action((options) => {
        const overrides: PartialConfig = {};

        if (options.debug) {
          overrides.debug = true;
        }
        if (options.workers) {
          overrides.workers = { max: options.workers };
        }
        if (options.workersLoop) {
          overrides.workers = {
            ...overrides.workers,
            loopMs: options.workersLoop,
          };
        }

        if (options.host || options.port) {
          overrides.web = { host: options.host, port: options.port };
        }

        const server = new WebServer(overrides);
        server.start();
        server.workers.start();
      });
  }

  run(argv: string[]): void {
    this.program.parse(argv);
  }
}
