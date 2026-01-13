import { Command } from 'commander';
import { type PartialConfig } from '../../config.js';
import { WebServer } from './index.js';

export class WebProgram {
  private program: Command;

  constructor() {
    this.program = new Command();

    this.program
      .option('-d, --debug', 'enable debug mode')
      .option('-h, --host <host>', 'server host')
      .option('-p, --port <port>', 'server port', parseInt)
      .action((options: { debug?: boolean; host?: string; port?: number }) => {
        const overrides: PartialConfig = {};

        if (options.debug) {
          overrides.debug = true;
        }

        if (options.host) {
          overrides.web = overrides.web ?? {};
          overrides.web.host = options.host;
        }

        if (options.port) {
          overrides.web = overrides.web ?? {};
          overrides.web.port = options.port;
        }

        const server = new WebServer(overrides);
        void server.start();
        void server.workers.start();
      });
  }

  run(argv: string[]): void {
    this.program.parse(argv);
  }
}
