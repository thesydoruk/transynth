import fs from 'fs';
import path from 'path';
import { formatFlatObjectLines } from './logging/format';
import { PATHS } from './paths';

// ── Log levels ───────────────────────────────────────────────────────────────
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 } as const;
type LogLevel = keyof typeof LEVELS;

const resolveLevel = (): LogLevel => {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (raw in LEVELS) return raw as LogLevel;
  // Backward compat: DEBUG=1 → debug level
  if (process.env.DEBUG) return 'debug';
  return 'info';
};

const currentLevel = resolveLevel();
const levelNum = LEVELS[currentLevel];

const enabled = (lvl: LogLevel): boolean => LEVELS[lvl] <= levelNum;

// ── File transport ───────────────────────────────────────────────────────────
const logDir = PATHS.logs;

/** Subsystems that also get a dedicated daily log file under logs/<name>/. */
const SUBSYSTEMS_WITH_OWN_FILE = new Set([
  'llm',
  'rag',
  'translate',
  'verify',
  'locale',
  'import',
  'embed',
  'auth',
  'api',
]);

const ensureLogDir = (dir: string): void => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

type StreamKey = string;

const streamCache = new Map<StreamKey, fs.WriteStream>();
const streamDates = new Map<StreamKey, string>();

const streamKey = (subsystem: string | undefined, date: string): StreamKey =>
  subsystem ? `${subsystem}:${date}` : `main:${date}`;

const getStream = (subsystem?: string): fs.WriteStream => {
  const today = new Date().toISOString().slice(0, 10);
  const key = streamKey(subsystem, today);
  const prevDate = streamDates.get(key);

  if (streamCache.has(key) && prevDate === today) {
    return streamCache.get(key)!;
  }

  const existing = streamCache.get(key);
  if (existing) existing.end();

  const dir =
    subsystem && SUBSYSTEMS_WITH_OWN_FILE.has(subsystem) ? path.join(logDir, subsystem) : logDir;
  ensureLogDir(dir);

  const filePath = path.join(dir, `${today}.log`);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  streamCache.set(key, stream);
  streamDates.set(key, today);
  return stream;
};

// ── Formatting ───────────────────────────────────────────────────────────────
const ts = (): string => new Date().toISOString();

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Error);

const jsonReplacer = (_key: string, val: unknown): unknown => {
  if (val instanceof Error) {
    return { message: val.message, stack: val.stack };
  }
  return val;
};

const serializeValue = (v: unknown): string => {
  if (v instanceof Error) return `${v.message}\n${v.stack ?? ''}`;
  if (typeof v === 'object' && v !== null) return JSON.stringify(v, jsonReplacer);
  return String(v);
};

/** Supports `logger.info('msg')`, `logger.info({a:1}, 'msg')`, and `logger.info('msg', {a:1})`. */
const formatArgs = (args: unknown[]): string => {
  if (args.length === 0) return '';

  if (args.length >= 2 && typeof args[1] === 'string' && isPlainObject(args[0])) {
    const kv = formatFlatObjectLines(args[0]);
    return kv ? `${args[1]}\n${kv}` : `${args[1]} ${serializeValue(args[0])}`;
  }

  if (args.length >= 2 && typeof args[0] === 'string' && isPlainObject(args[1])) {
    const kv = formatFlatObjectLines(args[1]);
    return kv ? `${args[0]}\n${kv}` : `${args[0]} ${serializeValue(args[1])}`;
  }

  return args.map(serializeValue).join(' ');
};

const fmt = (level: LogLevel, subsystem: string | undefined, args: unknown[]): string => {
  const tag = subsystem ? `[${subsystem.toUpperCase()}] ` : '';
  return `${ts()} [${level.toUpperCase().padEnd(5)}] ${tag}${formatArgs(args)}`;
};

// ── Console output (with colour) ────────────────────────────────────────────
const COLOUR: Record<LogLevel, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  trace: '\x1b[90m',
};
const RESET = '\x1b[0m';

const writeLine = (level: LogLevel, subsystem: string | undefined, line: string): void => {
  try {
    getStream().write(line + '\n');
    if (subsystem && SUBSYSTEMS_WITH_OWN_FILE.has(subsystem)) {
      getStream(subsystem).write(line + '\n');
    }
  } catch {
    /* swallow file errors */
  }
};

const emit = (level: LogLevel, subsystem: string | undefined, args: unknown[]): void => {
  if (!enabled(level)) return;
  const line = fmt(level, subsystem, args);

  if (level === 'error') console.error(`${COLOUR[level]}${line}${RESET}`);
  else if (level === 'warn') console.warn(`${COLOUR[level]}${line}${RESET}`);
  else console.log(`${COLOUR[level]}${line}${RESET}`);

  writeLine(level, subsystem, line);
};

export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  isDebug: () => boolean;
  isTrace: () => boolean;
}

const makeLogger = (subsystem?: string): Logger => ({
  error: (...args: unknown[]) => emit('error', subsystem, args),
  warn: (...args: unknown[]) => emit('warn', subsystem, args),
  info: (...args: unknown[]) => emit('info', subsystem, args),
  debug: (...args: unknown[]) => emit('debug', subsystem, args),
  trace: (...args: unknown[]) => emit('trace', subsystem, args),
  isDebug: () => enabled('debug'),
  isTrace: () => enabled('trace'),
});

/** Create a subsystem-scoped logger (also writes to logs/<subsystem>/). */
export const createLogger = (subsystem: string): Logger => makeLogger(subsystem);

/** Flush and close all file streams (call on shutdown). */
export const closeLogStreams = (): void => {
  for (const stream of streamCache.values()) stream.end();
  streamCache.clear();
  streamDates.clear();
};

/** Root logger — prefer {@link createLogger} or `src/logging/loggers.ts` in new code. */
export const log: Logger = makeLogger('app');
