#!/usr/bin/env node

import { WebProgram } from './program.js';

export * from './program.js';
export * from './server.js';

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new WebProgram();
  program.run(process.argv);
}
