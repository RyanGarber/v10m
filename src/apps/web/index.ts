#!/usr/bin/env node

import url from 'url';
import { WebProgram } from './program.js';

export * from './program.js';
export * from './server.js';

// Execute if run directly or via pm2
const __filename = url.fileURLToPath(import.meta.url);
if (__filename === process.argv[1] || __filename === process.env.pm_exec_path) {
  const program = new WebProgram();
  program.run(process.argv);
}
