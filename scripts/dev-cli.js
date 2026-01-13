import { spawn } from 'child_process';

console.log('Starting CLI in watch mode...', process.argv.slice(2));

const cli = spawn(
  'node',
  [
    '--inspect=9229',
    '--import',
    'tsx',
    '--enable-source-maps',
    '--watch',
    'src/apps/cli/index.ts',
    '--',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    shell: true,
  }
);

cli.on('error', (error) => {
  console.error('CLI failed to start:', error);
  process.exit(1);
});

cli.on('exit', (code) => {
  if (code !== 0) {
    console.error('CLI exited with code:', code);
    process.exit(code);
  }
});

process.on('SIGINT', () => {
  if (cli.pid) process.kill(cli.pid, 'SIGTERM');
  process.exit(0);
});
