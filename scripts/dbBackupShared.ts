import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { parseDatabaseUrl, resolveDatabaseUrl } from '../src/databaseUrl';
import { log } from '../src/logger';
import { PATHS, ensureDataDirs } from '../src/paths';

/** Default dump file name under {@link PATHS.backups}. */
export const DEFAULT_DUMP_FILENAME = 'localizer.dump';

/** Resolve dump file path (absolute). Uses `data/backups/localizer.dump` when omitted. */
export const resolveDumpPath = (fileArg?: string): string => {
  ensureDataDirs();
  const trimmed = fileArg?.trim();
  if (trimmed) {
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  }
  return path.join(PATHS.backups, DEFAULT_DUMP_FILENAME);
};

const spawnAsync = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  stdio: 'inherit' | { stdin?: fs.ReadStream; stdout?: fs.WriteStream },
): Promise<number> => {
  return new Promise((resolve, reject) => {
    const stdinOpt = typeof stdio === 'string' ? stdio : stdio.stdin ? 'pipe' : 'ignore';
    const stdoutOpt = typeof stdio === 'string' ? stdio : stdio.stdout ? 'pipe' : 'inherit';

    const child = spawn(command, args, {
      env,
      stdio: [stdinOpt, stdoutOpt, 'inherit'],
      shell: false,
    });

    if (typeof stdio !== 'string' && stdio.stdin && child.stdin) {
      stdio.stdin.pipe(child.stdin);
    }
    if (typeof stdio !== 'string' && stdio.stdout && child.stdout) {
      child.stdout.pipe(stdio.stdout);
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(0);
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
};

const commandExists = async (command: string): Promise<boolean> => {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    const child = spawn(checker, [command], { stdio: 'ignore', shell: false });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
};

const DOCKER_DB_USER = process.env.POSTGRES_USER || 'localizer';
const DOCKER_DB_NAME = process.env.POSTGRES_DB || 'localizer';

/** True when DATABASE_URL targets the Docker-published Postgres port on localhost. */
const isDockerMappedLocalDb = (): boolean => {
  const { host, port } = parseDatabaseUrl(resolveDatabaseUrl());
  const h = host.toLowerCase();
  return (h === 'localhost' || h === '127.0.0.1') && port === '5433';
};

const missingPgClientError = (tool: 'pg_dump' | 'pg_restore'): Error =>
  new Error(
    `${tool} not found on PATH. Install PostgreSQL client tools, or point DATABASE_URL at local Docker Postgres (localhost:5433) while the db container is running.`,
  );

const pgEnv = (): NodeJS.ProcessEnv => {
  const { password } = parseDatabaseUrl(resolveDatabaseUrl());
  return { ...process.env, PGPASSWORD: password };
};

const dumpViaLocalPgDump = async (outFile: string): Promise<void> => {
  const dbUrl = resolveDatabaseUrl();
  await spawnAsync(
    'pg_dump',
    ['--dbname', dbUrl, '-Fc', '--no-owner', '--no-acl', '-f', outFile],
    pgEnv(),
    'inherit',
  );
};

const dumpViaDocker = async (outFile: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const outStream = fs.createWriteStream(outFile);
    const child = spawn(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'db',
        'pg_dump',
        '-U',
        DOCKER_DB_USER,
        '-d',
        DOCKER_DB_NAME,
        '-Fc',
        '--no-owner',
        '--no-acl',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );

    child.on('error', reject);
    outStream.on('error', reject);
    child.stdout?.on('error', reject);

    child.stdout?.pipe(outStream);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`docker compose pg_dump exited with code ${code ?? 'unknown'}`));
        return;
      }
      outStream.end(() => resolve());
    });
  });
};

/** Create a PostgreSQL custom-format dump at `outFile`. */
export const dumpDatabase = async (outFile: string): Promise<void> => {
  ensureDataDirs();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const dbUrl = resolveDatabaseUrl();
  log.info(`DB dump: ${dbUrl} → ${outFile}`);

  if (await commandExists('pg_dump')) {
    await dumpViaLocalPgDump(outFile);
  } else if (isDockerMappedLocalDb()) {
    log.info('pg_dump not found locally; using docker compose exec db pg_dump');
    await dumpViaDocker(outFile);
  } else {
    throw missingPgClientError('pg_dump');
  }

  const stat = fs.statSync(outFile);
  log.info(`DB dump complete (${stat.size} bytes): ${outFile}`);
};

const restoreViaLocalPgRestore = async (inFile: string): Promise<void> => {
  const dbUrl = resolveDatabaseUrl();
  await spawnAsync(
    'pg_restore',
    ['--dbname', dbUrl, '--clean', '--if-exists', '--no-owner', '--no-acl', inFile],
    pgEnv(),
    'inherit',
  );
};

const restoreViaDocker = async (inFile: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const inStream = fs.createReadStream(inFile);
    const child = spawn(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'db',
        'pg_restore',
        '-U',
        DOCKER_DB_USER,
        '-d',
        DOCKER_DB_NAME,
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );

    child.on('error', reject);
    inStream.on('error', reject);
    if (!child.stdin) {
      reject(new Error('docker compose pg_restore stdin unavailable'));
      return;
    }

    inStream.pipe(child.stdin);
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`docker compose pg_restore exited with code ${code ?? 'unknown'}`));
        return;
      }
      resolve();
    });
  });
};

/** Terminate other sessions so pg_restore --clean can drop objects. */
export const terminateOtherDbSessions = async (): Promise<void> => {
  const parts = parseDatabaseUrl(resolveDatabaseUrl());
  const client = new pg.Client({
    user: parts.user,
    password: parts.password,
    host: parts.host,
    port: parseInt(parts.port, 10),
    database: parts.database,
  });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [parts.database],
    );
    if ((rowCount ?? 0) > 0) {
      log.info(`DB restore: terminated ${rowCount} other session(s)`);
    }
  } finally {
    await client.end();
  }
};

/** Restore database from a pg_dump custom-format file. */
export const restoreDatabase = async (inFile: string): Promise<void> => {
  if (!fs.existsSync(inFile)) {
    throw new Error(`Dump file not found: ${inFile}`);
  }

  const dbUrl = resolveDatabaseUrl();
  log.warn(`DB restore: ${inFile} → ${dbUrl}`);

  await terminateOtherDbSessions();

  try {
    if (await commandExists('pg_restore')) {
      await restoreViaLocalPgRestore(inFile);
    } else if (isDockerMappedLocalDb()) {
      log.info('pg_restore not found locally; using docker compose exec db pg_restore');
      await restoreViaDocker(inFile);
    } else {
      throw missingPgClientError('pg_restore');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // pg_restore may exit 1 when dropping absent objects on empty DB — still usable.
    if (message.includes('exited with code 1')) {
      log.warn('DB restore finished with non-fatal pg_restore warnings (exit code 1)');
    } else {
      throw err;
    }
  }

  log.info(`DB restore complete from ${inFile}`);
};
