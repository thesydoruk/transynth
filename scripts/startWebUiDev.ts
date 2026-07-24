/**
 * Waits for the API port from `.env`, then starts the Vite dev server with matching proxy target.
 */
import '../src/loadEnv';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.env.PORT ?? '3000';

execSync(`npx wait-on tcp:${port}`, { stdio: 'inherit' });
execSync('npm run dev', {
  stdio: 'inherit',
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web-ui'),
  env: { ...process.env, PORT: port },
});
