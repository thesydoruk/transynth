#!/usr/bin/env tsx
/**
 * Isolated FaceFXWrapper runner for Windows (no inherited console — avoids AttachConsole spam).
 * stdout: one JSON line { ok, lipPath, summary }
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFaceFxLip, type FaceFxLipResult } from './lipCore';

const run = async (): Promise<void> => {
  const [game, fonixPath, wavPath, resampledPath, lipPath, faceFxExe, ...textParts] =
    process.argv.slice(2);
  if (!game || !fonixPath || !wavPath || !resampledPath || !lipPath || !faceFxExe) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        lipPath: lipPath ?? '',
        summary: 'faceFxRunner: missing arguments',
      } satisfies FaceFxLipResult),
    );
    process.exit(1);
    return;
  }

  const result = await runFaceFxLip({
    game,
    fonixPath,
    wavPath,
    resampledPath,
    lipPath,
    faceFxExe,
    dialogueText: textParts.join(' '),
  });

  process.stdout.write(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
};

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href;

if (isMain) {
  run().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({ ok: false, lipPath: '', summary: message } satisfies FaceFxLipResult),
    );
    process.exit(1);
  });
}
