import { execSync } from 'node:child_process';
import fs from 'fs';
import esbuild from 'esbuild';

try {
  console.log('Cleaning old build...');
  execSync('npm run clean', { stdio: 'inherit' });

  console.log('Compiling new build...');
  execSync('tsc', { stdio: 'inherit' });

  console.log('Copying web views...');
  fs.mkdirSync('./dist/apps/web/views', { recursive: true });
  fs.cpSync('./src/apps/web/views', './dist/apps/web/views', { recursive: true });

  console.log('Copying web static...');
  fs.mkdirSync('./dist/apps/web/static', { recursive: true });
  fs.cpSync('./src/apps/web/static', './dist/apps/web/static', { recursive: true });

  console.log('Bundling web into static...');
  await esbuild.build({
    entryPoints: ['./src/apps/web/views/app.ts'],
    outdir: './dist/apps/web/static',
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'esm',
  });

  console.log('Build succeeded!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
