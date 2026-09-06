/**
 * FaceFXWrapper `serve` stdin protocol (thesydoruk/FaceFXWrapper 0.50+).
 *
 * One persistent Wine process per prefix keeps CK mapped.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type FaceFxServeJob = {
  language: string;
  fonixWinPath: string;
  wavWinPath: string;
  lipWinPath: string;
  text: string;
};

export type FxwReply =
  | { kind: 'ready'; type: string }
  | { kind: 'ok' }
  | { kind: 'err'; message: string }
  | { kind: 'bye' };

export const encodeLipJob = (job: FaceFxServeJob): Buffer => {
  const text = Buffer.from(job.text, 'utf8');
  const header = `LIP\n${job.language}\n${job.fonixWinPath}\n${job.wavWinPath}\n${job.lipWinPath}\n${text.length}\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), text, Buffer.from('\n')]);
};

export const parseFxwLine = (line: string): FxwReply | null => {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed.startsWith('FXW ')) return null;
  if (trimmed === 'FXW OK') return { kind: 'ok' };
  if (trimmed === 'FXW BYE') return { kind: 'bye' };
  if (trimmed.startsWith('FXW READY ')) {
    return { kind: 'ready', type: trimmed.slice('FXW READY '.length).trim() };
  }
  if (trimmed.startsWith('FXW ERR')) {
    return { kind: 'err', message: trimmed.slice('FXW ERR'.length).trim() };
  }
  return null;
};

export type FaceFxServeMode = 'unknown' | 'serve';

type WineEnvFn = (prefix: string) => NodeJS.ProcessEnv;

type ServePoolOptions = {
  wine: string;
  exe: string;
  wineEnv: WineEnvFn;
  readyTimeoutMs: number;
  jobTimeoutMs: number;
};

type LineWaiter = {
  resolve: (reply: FxwReply) => void;
  reject: (err: Error) => void;
};

class FaceFxServeWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private waiters: LineWaiter[] = [];
  private tail = Promise.resolve();
  private booted = false;
  isDead = false;

  readonly ready: Promise<void>;

  constructor(
    private readonly prefix: string,
    private readonly gameType: string,
    private readonly opts: ServePoolOptions,
  ) {
    this.ready = this.boot();
  }

  private boot(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.wine, [this.opts.exe, 'serve', this.gameType], {
        env: this.opts.wineEnv(this.prefix),
        windowsHide: true,
      });
      this.child = child;

      const failBoot = (err: Error): void => {
        this.isDead = true;
        this.flushWaiters(err);
        reject(err);
      };

      const timer = setTimeout(() => {
        child.kill();
        failBoot(new Error(`FaceFX serve READY timeout (${this.gameType})`));
      }, this.opts.readyTimeoutMs);

      const consume = (chunk: string): void => {
        this.buf += chunk;
        const lines = this.buf.split('\n');
        this.buf = lines.pop() ?? '';
        for (const raw of lines) {
          const reply = parseFxwLine(raw);
          if (!reply) continue;
          if (reply.kind === 'ready') {
            this.booted = true;
            clearTimeout(timer);
            resolve();
            continue;
          }
          const waiter = this.waiters.shift();
          if (waiter) waiter.resolve(reply);
        }
      };
      child.stdout.on('data', (chunk: Buffer) => consume(chunk.toString('utf8')));
      child.stderr.on('data', () => {});
      child.on('error', (err: Error) => {
        clearTimeout(timer);
        failBoot(err);
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        this.isDead = true;
        this.child = null;
        if (this.buf) consume(`${this.buf}\n`);
        this.flushWaiters(new Error(`FaceFX serve exited ${code ?? 'null'}`));
        if (!this.booted) failBoot(new Error(`FaceFX serve exited ${code ?? 'null'} before READY`));
      });
    });
  }

  private flushWaiters(err: Error): void {
    const pending = this.waiters.splice(0);
    for (const waiter of pending) waiter.reject(err);
  }

  private nextReply(timeoutMs: number): Promise<FxwReply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('FaceFX serve job timeout'));
      }, timeoutMs);
      this.waiters.push({
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  run(job: FaceFxServeJob): Promise<void> {
    const work = async (): Promise<void> => {
      await this.ready;
      if (this.isDead || !this.child?.stdin.writable) {
        throw new Error('FaceFX serve worker is dead');
      }
      const replyP = this.nextReply(this.opts.jobTimeoutMs);
      this.child.stdin.write(encodeLipJob(job));
      const reply = await replyP;
      if (reply.kind === 'ok') return;
      if (reply.kind === 'err') throw new Error(`FaceFX serve: ${reply.message}`);
      throw new Error(`FaceFX serve unexpected ${reply.kind}`);
    };
    const next = this.tail.then(work, work);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  kill(): void {
    this.isDead = true;
    this.child?.kill();
    this.child = null;
  }

  quit(): void {
    if (!this.child) return;
    try {
      this.child.stdin.write('QUIT\n');
    } catch {
      this.kill();
    }
  }
}

export const createFaceFxServePool = (opts: ServePoolOptions) => {
  const workers = new Map<string, FaceFxServeWorker>();
  let mode: FaceFxServeMode = 'unknown';

  const keyOf = (prefix: string, gameType: string): string => `${prefix}\0${gameType}`;

  const drop = (key: string, worker: FaceFxServeWorker): void => {
    if (workers.get(key) === worker) workers.delete(key);
    worker.kill();
  };

  const ensure = async (prefix: string, gameType: string): Promise<FaceFxServeWorker> => {
    const key = keyOf(prefix, gameType);
    const existing = workers.get(key);
    if (existing && !existing.isDead) {
      await existing.ready;
      return existing;
    }
    const worker = new FaceFxServeWorker(prefix, gameType, opts);
    workers.set(key, worker);
    await worker.ready;
    return worker;
  };

  /** Start serve on one prefix. Retries a cold Wine miss; then fails. */
  const probe = async (prefix: string, gameType: string): Promise<void> => {
    if (mode === 'serve') return;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        workers.delete(keyOf(prefix, gameType));
        await ensure(prefix, gameType);
        mode = 'serve';
        return;
      } catch (err) {
        lastErr = err;
        process.stdout.write(
          `bethesda-tools facefxServe probe ${attempt}/3 failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('FaceFX serve failed to start');
  };

  const runLip = async (prefix: string, gameType: string, job: FaceFxServeJob): Promise<void> => {
    await probe(prefix, gameType);
    const key = keyOf(prefix, gameType);
    const worker = await ensure(prefix, gameType);
    try {
      await worker.run(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const desynced = worker.isDead || /timeout/i.test(message);
      if (desynced) drop(key, worker);
      throw err;
    }
  };

  const warm = async (prefixes: readonly string[], gameType: string): Promise<void> => {
    if (prefixes.length === 0) return;
    await probe(prefixes[0]!, gameType);
    await Promise.all(prefixes.slice(1).map((prefix) => ensure(prefix, gameType)));
  };

  const shutdown = (): void => {
    for (const worker of workers.values()) worker.quit();
    workers.clear();
  };

  const snapshot = (): { mode: FaceFxServeMode; workers: number } => ({
    mode,
    workers: [...workers.values()].filter((worker) => !worker.isDead).length,
  });

  return {
    probe,
    runLip,
    warm,
    shutdown,
    snapshot,
    get mode() {
      return mode;
    },
  };
};

export type FaceFxServePool = ReturnType<typeof createFaceFxServePool>;
