#!/usr/bin/env node

import { Program } from './program.js';

export { Program };

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new Program();
  program.run(process.argv);
}
