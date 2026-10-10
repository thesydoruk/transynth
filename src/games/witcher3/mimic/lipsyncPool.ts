/**
 * Generate lip blocks on worker threads.
 *
 * The mouth model is plain arithmetic — ~90 ms of it for an average line — and
 * on the main thread it would serialize every voice worker behind it. A small
 * pool of threads, each with the model loaded once, runs it beside the TTS
 * requests instead.
 *
 * Where a worker cannot start (no TypeScript loader in the process, as under
 * Jest), jobs run on the calling thread: slower, same result.
 */
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { log } from '../../../logger';
import { generateLipsyncBlock, type GenerateLipsyncInput } from './generate';
import type { LipsyncJob, LipsyncReply } from './lipsyncWorker';

type Pending = { resolve: (block: Buffer) => void; reject: (err: Error) => void };

class LipsyncPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Array<{ job: LipsyncJob; pending: Pending }> = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  failed = false;

  constructor(
    /** Model file and its modification time: a retrained model gets a new pool. */
    readonly modelKey: string,
    private readonly modelPath: string,
    size: number,
  ) {
    for (let i = 0; i < size; i++) this.spawn();
  }

  private spawn(): void {
    // The entry is TypeScript. A worker inherits the process's `--import tsx`
    // but not its resolver for extensionless imports, so the bootstrap
    // registers tsx in the thread itself before loading the entry.
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: { modelPath: this.modelPath, entry: WORKER_ENTRY },
    });
    worker.unref();
    worker.on('message', (message: LipsyncReply | { ready: true }) => {
      if ('ready' in message) {
        this.release(worker);
        return;
      }
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      this.release(worker);
      if (!pending) return;
      if (message.block) {
        pending.resolve(
          Buffer.from(message.block.buffer, message.block.byteOffset, message.block.byteLength),
        );
      } else pending.reject(new Error(message.error ?? 'lip worker failed'));
    });
    worker.on('error', (err) => this.fail(err));
    this.workers.push(worker);
  }

  private release(worker: Worker): void {
    const next = this.queue.shift();
    if (next) this.dispatch(worker, next.job, next.pending);
    else this.idle.push(worker);
  }

  private dispatch(worker: Worker, job: LipsyncJob, pending: Pending): void {
    this.pending.set(job.id, pending);
    worker.postMessage(job, [job.pcm.buffer as ArrayBuffer]);
  }

  /** Workers that cannot start take every job still waiting down with them. */
  private fail(err: Error): void {
    if (this.failed) return;
    this.failed = true;
    log.warn(`Witcher 3 lip workers unavailable, generating on the main thread: ${err.message}`);
    const waiting = [...this.queue.map((q) => q.pending), ...this.pending.values()];
    this.queue.length = 0;
    this.pending.clear();
    for (const pending of waiting) pending.reject(err);
    for (const worker of this.workers) void worker.terminate();
  }

  close(): void {
    for (const worker of this.workers) void worker.terminate();
  }

  get busy(): boolean {
    return this.pending.size > 0 || this.queue.length > 0;
  }

  run(input: Omit<GenerateLipsyncInput, 'model'>): Promise<Buffer> {
    const job: LipsyncJob = {
      id: this.nextId++,
      // Copies, so transferring them leaves the caller's buffers intact.
      pcm: new Float32Array(input.pcm),
      takeDuration: input.takeDuration,
      template: new Uint8Array(input.template),
    };
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject };
      const worker = this.idle.pop();
      if (worker) this.dispatch(worker, job, pending);
      else this.queue.push({ job, pending });
    });
  }
}

const WORKER_ENTRY = new URL('./lipsyncWorker.ts', import.meta.url).href;
const TSX_API = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href;
const WORKER_BOOTSTRAP = `
  const { workerData } = require('node:worker_threads');
  import(${JSON.stringify(TSX_API)})
    .then(({ register }) => { register(); return import(workerData.entry); });
`;

let pool: LipsyncPool | null = null;

/**
 * Threads stop after this long without work. A worker keeps the process alive
 * even unref'd once tsx has registered in it, so a CLI would otherwise never
 * exit; a voice job's lines arrive far closer together than this.
 */
const IDLE_CLOSE_MS = 5000;
let idleTimer: NodeJS.Timeout | null = null;

const closeWhenIdle = (): void => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pool && !pool.busy) closeLipsyncPool();
  }, IDLE_CLOSE_MS);
  idleTimer.unref();
};

const modelKeyOf = (modelPath: string): string | null => {
  try {
    return `${modelPath}@${fs.statSync(modelPath).mtimeMs}`;
  } catch {
    return null;
  }
};

const poolSize = (): number => Math.max(1, Math.min(4, os.availableParallelism() - 1));

/**
 * {@link generateLipsyncBlock} on a worker thread when `modelPath` is given and
 * workers can run, else on this one with `input.model`.
 */
export const generateLipsyncBlockOffThread = async (
  input: GenerateLipsyncInput,
  modelPath: string | null,
): Promise<Buffer> => {
  const key = modelPath ? modelKeyOf(modelPath) : null;
  if (modelPath && key && !(pool?.failed && pool.modelKey === key)) {
    if (!pool || pool.modelKey !== key) {
      pool?.close();
      pool = new LipsyncPool(key, modelPath, poolSize());
    }
    try {
      return await pool.run(input);
    } catch (err) {
      if (!pool.failed) throw err;
    } finally {
      closeWhenIdle();
    }
  }
  return generateLipsyncBlock(input);
};

/** Stop the workers (tests, shutdown); the next job starts a new pool. */
export const closeLipsyncPool = (): void => {
  pool?.close();
  pool = null;
};
