import { execSync } from 'node:child_process';
import fs from 'fs';

const watch = process.argv.includes('--watch');

if (watch) {
  console.log('Compiling in watch mode...');
  execSync('tsc --watch', { stdio: 'inherit' });
} else {
  try {
    console.log('Cleaning old build...');
    execSync('npm run clean', { stdio: 'inherit' });

    console.log('Compiling new build...');
    execSync('tsc', { stdio: 'inherit' });

    console.log('Copying static files...');
    fs.mkdirSync('./dist/apps/web/views', { recursive: true });
    fs.cpSync('./src/apps/web/views', './dist/apps/web/views', { recursive: true });

    fs.mkdirSync('./dist/apps/web/static', { recursive: true });
    fs.cpSync('./src/apps/web/static', './dist/apps/web/static', { recursive: true });

    console.log('Build succeeded!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}
