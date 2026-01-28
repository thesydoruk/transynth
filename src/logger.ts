import fs from 'fs';
import path from 'path';

// ── Log levels ───────────────────────────────────────────────────────────────
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 } as const;
type LogLevel = keyof typeof LEVELS;

const resolveLevel = (): LogLevel => {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (raw in LEVELS) return raw as LogLevel;
  // Backward compat: DEBUG=1 → debug level
  if (process.env.DEBUG) return 'debug';
  return 'info';
}

const currentLevel = resolveLevel();
const levelNum = LEVELS[currentLevel];

const enabled = (lvl: LogLevel): boolean => {
  return LEVELS[lvl] <= levelNum;
}

// ── File transport ───────────────────────────────────────────────────────────
const logDir = process.env.LOG_DIR || './logs';

const ensureLogDir = (): void => {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
}

let _logStream: fs.WriteStream | null = null;
let _streamDate = '';

const getStream = (): fs.WriteStream => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (_logStream && _streamDate === today) return _logStream;
  if (_logStream) _logStream.end();
  ensureLogDir();
  const filePath = path.join(logDir, `${today}.log`);
  _logStream = fs.createWriteStream(filePath, { flags: 'a' });
  _streamDate = today;
  return _logStream;
}

// ── Formatting ───────────────────────────────────────────────────────────────
const ts = (): string => {
  return new Date().toISOString();
}

const fmt = (level: LogLevel, args: unknown[]): string => {
  const parts = args.map(a =>
    a instanceof Error ? `${a.message}\n${a.stack ?? ''}`
      : typeof a === 'object' && a !== null ? JSON.stringify(a)
      : String(a),
  );
  return `${ts()} [${level.toUpperCase().padEnd(5)}] ${parts.join(' ')}`;
}

// ── Console output (with colour) ────────────────────────────────────────────
const COLOUR: Record<LogLevel, string> = {
  error: '\x1b[31m', // red
  warn:  '\x1b[33m', // yellow
  info:  '\x1b[36m', // cyan
  debug: '\x1b[90m', // grey
  trace: '\x1b[90m', // grey
};
const RESET = '\x1b[0m';

const emit = (level: LogLevel, args: unknown[]): void => {
  if (!enabled(level)) return;
  const line = fmt(level, args);

  // Console
  if (level === 'error') console.error(`${COLOUR[level]}${line}${RESET}`);
  else if (level === 'warn') console.warn(`${COLOUR[level]}${line}${RESET}`);
  else console.log(`${COLOUR[level]}${line}${RESET}`);

  // File (always, regardless of isTTY)
  try { getStream().write(line + '\n'); } catch { /* swallow file errors */ }
}

// ── Public API ───────────────────────────────────────────────────────────────
export const log = {
  error: (...a: unknown[]) => emit('error', a),
  warn:  (...a: unknown[]) => emit('warn', a),
  info:  (...a: unknown[]) => emit('info', a),
  debug: (...a: unknown[]) => emit('debug', a),
  trace: (...a: unknown[]) => emit('trace', a),

  /** Check if a specific level is enabled (useful for expensive formatting). */
  isDebug: () => enabled('debug'),
  isTrace: () => enabled('trace'),

  /** Flush and close the file stream (call on shutdown). */
  close: () => { if (_logStream) { _logStream.end(); _logStream = null; } },
};
