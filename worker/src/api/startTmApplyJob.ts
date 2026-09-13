import { startBackgroundJob } from './startBackgroundJob';

/** Same `tm-apply` job the editor starts — no SSE hold. */
export const startTmApplyJob = async (
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<number> =>
  startBackgroundJob(
    { kind: 'tm-apply', modId, params: { srcLang, targetLang } },
    { applied: 0, skipped: 0 },
  );
