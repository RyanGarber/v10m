import { spawn } from 'child_process';
import esbuild from 'esbuild';

console.log('Bundling web into static in watch mode...');

const bundler = await esbuild.context({
  entryPoints: ['src/apps/web/views/app.ts'],
  outdir: 'dist/apps/web/static',
  bundle: true,
  minify: false,
  sourcemap: true,
  format: 'esm',
});

await bundler.watch();

console.log('Starting web in watch mode...', process.argv.slice(2));

const web = spawn(
  'node',
  [
    '--inspect=9229',
    '--import',
    'tsx',
    '--enable-source-maps',
    '--watch',
    'src/apps/web/index.ts',
    '--',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    shell: true,
  }
);

web.on('error', (error) => {
  console.error('Web server failed to start:', error);
  process.exit(1);
});

web.on('exit', (code) => {
  if (code !== 0) {
    console.error('Web server exited with code:', code);
    process.exit(code);
  }
});

process.on('SIGINT', () => {
  if (web.pid) process.kill(web.pid, 'SIGTERM');
  bundler.dispose();
  process.exit(0);
});
