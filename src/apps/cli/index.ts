#!/usr/bin/env node

import { CliProgram } from './program.js';

export * from './program.js';

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new CliProgram();
  program.run(process.argv);
}
