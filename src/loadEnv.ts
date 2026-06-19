/**
 * Load project `.env` before any module reads `process.env`.
 *
 * Resolves `.env` from the repository root (not `process.cwd()`), so CLI scripts
 * work when invoked via absolute path or from another working directory.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
