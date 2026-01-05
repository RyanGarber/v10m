#!/usr/bin/env node

import { Command } from "commander";
import { type PartialConfig } from "../../config.js";
import { Server } from "./server.js";

export { Server };

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new Command();

  program
    .option("--debug", "enable debug mode")
    .option("--workers <number>", "maximum number of workers", parseInt)
    .option("--workers-loop <ms>", "worker loop interval in ms", parseInt)
    .option("-h, --host <host>", "server host")
    .option("-p, --port <port>", "server port", parseInt)
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

      const server = new Server(overrides);
      server.start();
      server.workers.start();
    });

  program.parse();
}
