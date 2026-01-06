#!/usr/bin/env node

import { Program } from './program.js';
import { Server } from './server.js';

export { Program, Server };

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new Program();
  program.run(process.argv);
}
