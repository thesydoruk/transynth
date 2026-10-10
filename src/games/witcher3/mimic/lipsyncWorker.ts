/**
 * Worker-thread entry for {@link ./lipsyncPool}: loads the mouth model once
 * and turns each posted take into a lip block, off the main thread.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { generateLipsyncBlock } from './generate';
import { loadMimicModel } from './model';

export type LipsyncJob = {
  id: number;
  pcm: Float32Array;
  takeDuration: number;
  template: Uint8Array;
};
export type LipsyncReply = { id: number; block?: Uint8Array; error?: string };

const port = parentPort!;
const model = loadMimicModel((workerData as { modelPath: string }).modelPath);

port.on('message', (job: LipsyncJob) => {
  try {
    const block = generateLipsyncBlock({
      pcm: job.pcm,
      takeDuration: job.takeDuration,
      model,
      template: Buffer.from(job.template.buffer, job.template.byteOffset, job.template.byteLength),
    });
    const out = new Uint8Array(block);
    port.postMessage({ id: job.id, block: out } satisfies LipsyncReply, [out.buffer]);
  } catch (err) {
    port.postMessage({
      id: job.id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies LipsyncReply);
  }
});
port.postMessage({ ready: true });
