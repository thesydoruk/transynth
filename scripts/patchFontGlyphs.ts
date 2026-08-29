#!/usr/bin/env tsx
/**
 * Repair placeholder glyphs in a Bethesda SWF font library.
 *
 * Vanilla `Interface/fonts_en.swf` maps most of the Cyrillic block onto one box
 * outline, so Ukrainian letters render as boxes in the terminal font. Each broken
 * letter is rebuilt from a glyph the same font already draws, which keeps the
 * original design and monospace advance.
 *
 * Verify the result with `npm run fonts:check -- --file <out>`.
 *
 * Usage:
 *   npm run fonts:patch -- --in <fonts_en.swf> --out <patched.swf> [options]
 *
 * Required:
 *   --in <path>         Source SWF font library
 *   --out <path>        Where to write the patched library
 *
 * Options:
 *   --font <name>       Only patch these font families (repeatable, default: all)
 *   --copy <to=from>    Reuse the outline of another character, e.g. --copy "і=i"
 *   --mirror <to=from>  Mirror an outline horizontally, e.g. --mirror "є=э"
 *   --upturn <to=from>  Add an upturn to a «Г»-like bar, e.g. --upturn "ґ=г"
 *
 * With no operation given, the full Ukrainian set is applied:
 *   і=i І=I ї=ï Ї=Ï (copy), є=э Є=Э (mirror), ґ=г Ґ=Г (upturn)
 *
 * Examples:
 *   npm run fonts:patch -- --in fonts_en.swf --out fonts_en.uk.swf
 *   npm run fonts:patch -- --in fonts_en.swf --out out.swf --font "Share-TechMono Regular"
 *   npm run fonts:patch -- --in fonts_en.swf --out out.swf --mirror "є=э"
 */
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  patchFontGlyphs,
  UKRAINIAN_GLYPH_OPS,
  type GlyphOp,
} from '../src/formats/swf/swfFontPatch';

const argv = await yargs(hideBin(process.argv))
  .scriptName('fonts:patch')
  .usage('$0 --in <path> --out <path> [options]')
  .option('in', { type: 'string', demandOption: true, describe: 'Source SWF font library' })
  .option('out', { type: 'string', demandOption: true, describe: 'Patched SWF to write' })
  .option('font', {
    type: 'array',
    string: true,
    describe: 'Restrict patching to these font families',
  })
  .option('copy', { type: 'array', string: true, describe: 'Reuse an outline, "target=source"' })
  .option('mirror', { type: 'array', string: true, describe: 'Mirror an outline, "target=source"' })
  .option('upturn', { type: 'array', string: true, describe: 'Add an upturn, "target=source"' })
  .strict()
  .help().argv;

/** Parse `"і=i"` into an operation of the given kind. */
const parseOp = (kind: GlyphOp['kind'], spec: string): GlyphOp => {
  const [to, from] = spec.split('=');
  if (!to || !from || [...to].length !== 1 || [...from].length !== 1) {
    throw new Error(`Invalid --${kind} "${spec}", expected a single character on each side`);
  }
  return { kind, from, to };
};

const requested: GlyphOp[] = [
  ...((argv.copy as string[] | undefined) ?? []).map((s) => parseOp('copy', s)),
  ...((argv.mirror as string[] | undefined) ?? []).map((s) => parseOp('mirror', s)),
  ...((argv.upturn as string[] | undefined) ?? []).map((s) => parseOp('upturn', s)),
];
const ops = requested.length > 0 ? requested : UKRAINIAN_GLYPH_OPS;

const inPath = path.resolve(argv.in);
const outPath = path.resolve(argv.out);
const source = fs.readFileSync(inPath);
const { buffer, results, appliedCount } = patchFontGlyphs(source, ops, argv.font as string[]);

const byFont = new Map<string, typeof results>();
for (const result of results) {
  const list = byFont.get(result.font);
  if (list) list.push(result);
  else byFont.set(result.font, [result]);
}

const verb: Record<GlyphOp['kind'], string> = {
  copy: 'copied from',
  mirror: 'mirrored from',
  upturn: 'built with an upturn from',
};

for (const [font, fontResults] of byFont) {
  // Fonts without any Cyrillic at all would only produce noise.
  if (fontResults.every((r) => r.reason === 'source-missing')) continue;
  console.log(`\n=== ${font} ===`);
  for (const { op, applied, reason } of fontResults) {
    console.log(
      applied ? `  "${op.to}" ${verb[op.kind]} "${op.from}"` : `  "${op.to}" skipped (${reason})`,
    );
  }
}

if (appliedCount === 0) {
  console.error('\nNothing to patch — no outline was replaced.');
  process.exit(1);
}

fs.writeFileSync(outPath, buffer);
console.log(
  `\nReplaced ${appliedCount} outline(s). ${path.basename(inPath)} ${source.length} bytes → ` +
    `${path.basename(outPath)} ${buffer.length} bytes`,
);
