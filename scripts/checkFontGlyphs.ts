#!/usr/bin/env tsx
/**
 * Report which fonts of a Bethesda SWF font library can render a character set.
 *
 * `Interface/FontConfig.txt` maps logical names ($MAIN_Font, $Terminal_Font, …)
 * onto font families embedded in `Interface/fonts_*.swf`. A family that lacks a
 * glyph renders it as a box in game, so this is the quickest way to tell whether
 * a font pack really covers Ukrainian «і/ї/є/ґ» before shipping it.
 *
 * Usage:
 *   npm run fonts:check -- --file <fonts_en.swf> [options]
 *
 * Required:
 *   --file <path>       SWF font library, `.ba2` archive, or folder holding either
 *                       (repeatable)
 *
 * Options:
 *   --chars <text>      Characters to test (default: Ukrainian-specific letters)
 *   --config <path>     FontConfig.txt to resolve logical names to families
 *   --verbose           Also print each font's covered Unicode ranges
 *
 * Examples:
 *   npm run fonts:check -- --file "D:\Games\Fallout4\Data" --config "D:\Games\Fallout4\Data\Interface\FontConfig.txt"
 *   npm run fonts:check -- --file "Fallout4 - Interface.ba2"
 *   npm run fonts:check -- --file fonts_en.swf --chars "іїєґ'—"
 */
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { getBa2Reader } from '../src/formats/ba2';
import {
  readSwfFonts,
  missingGlyphs,
  placeholderGlyphs,
  type SwfFont,
} from '../src/formats/swf/swfFonts';

const DEFAULT_CHARS = 'іїєґІЇЄҐ';

const argv = await yargs(hideBin(process.argv))
  .scriptName('fonts:check')
  .usage('$0 --file <path> [options]')
  .option('file', {
    type: 'array',
    string: true,
    demandOption: true,
    describe: 'SWF font library, or a folder containing fonts*.swf',
  })
  .option('chars', {
    type: 'string',
    default: DEFAULT_CHARS,
    describe: 'Characters to test for coverage',
  })
  .option('config', { type: 'string', describe: 'FontConfig.txt mapping logical font names' })
  .option('verbose', { type: 'boolean', default: false, describe: "Print each font's ranges" })
  .strict()
  .help().argv;

type FontSource = { label: string; load: () => Buffer };

const isFontSwf = (name: string): boolean => /(^|[\\/])fonts[^\\/]*\.swf$/i.test(name);

/** Texture archives hold no fonts and their file tables are huge. */
const isTextureArchive = (name: string): boolean => /textures\w*\.ba2$/i.test(name);

const collectFromBa2 = (ba2Path: string): FontSource[] => {
  const reader = getBa2Reader(ba2Path);
  return reader
    .listByExt('swf')
    .filter((entry) => isFontSwf(entry.name))
    .map((entry) => ({
      label: `${path.basename(ba2Path)} → ${entry.name}`,
      load: () => reader.extractEntry(entry),
    }));
};

/** Expand a folder into the font libraries it holds, loose or inside archives. */
const collectFromDir = (dir: string): FontSource[] => {
  const sources: FontSource[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) {
      if (/^interface$/i.test(name)) sources.push(...collectFromDir(abs));
      continue;
    }
    if (isFontSwf(name)) {
      sources.push({ label: name, load: () => fs.readFileSync(abs) });
    } else if (/\.ba2$/i.test(name) && !isTextureArchive(name)) {
      sources.push(...collectFromBa2(abs));
    }
  }
  return sources;
};

const resolveFontSources = (inputs: string[]): FontSource[] => {
  const sources: FontSource[] = [];
  for (const input of inputs) {
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) {
      console.error(`Not found: ${abs}`);
      continue;
    }
    if (fs.statSync(abs).isDirectory()) sources.push(...collectFromDir(abs));
    else if (/\.ba2$/i.test(abs)) sources.push(...collectFromBa2(abs));
    else sources.push({ label: path.basename(abs), load: () => fs.readFileSync(abs) });
  }
  return sources;
};

/** Parse `map "$Logical" = "Family" Style` lines of FontConfig.txt. */
const readFontConfigMap = (configPath: string): Map<string, string[]> => {
  const byFamily = new Map<string, string[]>();
  const content = fs.readFileSync(configPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*map\s+"([^"]+)"\s*=\s*"([^"]+)"/.exec(line);
    if (!match) continue;
    const logical = match[1];
    const family = match[2];
    const list = byFamily.get(family);
    if (list) list.push(logical);
    else byFamily.set(family, [logical]);
  }
  return byFamily;
};

/** Condense a code point set into readable `U+0400-U+045F` ranges. */
const formatRanges = (codePoints: Set<number>): string => {
  const sorted = [...codePoints].sort((a, b) => a - b);
  const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  const parts: string[] = [];
  let start = -1;
  let prev = -1;

  for (const cp of sorted) {
    if (start === -1) {
      start = cp;
    } else if (cp !== prev + 1) {
      parts.push(start === prev ? hex(start) : `${hex(start)}-${hex(prev)}`);
      start = cp;
    }
    prev = cp;
  }
  if (start !== -1) parts.push(start === prev ? hex(start) : `${hex(start)}-${hex(prev)}`);
  return parts.join(', ');
};

const logicalNamesFor = (font: SwfFont, byFamily: Map<string, string[]> | null): string => {
  if (!byFamily) return '';
  const names = [font.displayName, font.name].filter(Boolean) as string[];
  for (const name of names) {
    const logical = byFamily.get(name);
    if (logical) return ` [${logical.join(', ')}]`;
  }
  return '';
};

const sources = resolveFontSources(argv.file as string[]);
if (sources.length === 0) {
  console.error('No SWF font libraries to inspect.');
  process.exit(1);
}

const byFamily = argv.config ? readFontConfigMap(path.resolve(argv.config)) : null;
let missingTotal = 0;

for (const source of sources) {
  console.log(`\n=== ${source.label} ===`);
  let fonts: SwfFont[];
  try {
    fonts = readSwfFonts(source.load());
  } catch (err) {
    console.error(`  failed to parse: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (fonts.length === 0) console.log('  no embedded fonts');

  for (const font of fonts) {
    const label = `${font.displayName ?? font.name}${logicalNamesFor(font, byFamily)}`;
    if (font.cffOnly) {
      console.log(`  ${label}: DefineFont4 (CFF) — coverage not decodable`);
      continue;
    }
    const missing = missingGlyphs(font, argv.chars);
    const placeholders = placeholderGlyphs(font, argv.chars);
    const status = missing.length === 0 ? 'OK' : `MISSING ${missing.join(' ')}`;
    console.log(`  ${label}: ${font.codePoints.size} glyphs — ${status}`);
    if (missing.length > 0 || placeholders.length > 0) missingTotal++;

    for (const placeholder of placeholders) {
      console.log(
        `      PLACEHOLDER "${placeholder.char}": ${placeholder.shapeSize}-byte outline shared ` +
          `with ${placeholder.sharedWith} other code point(s) [${placeholder.sharedChars.join(' ')}]`,
      );
    }
    if (argv.verbose) console.log(`      ${formatRanges(font.codePoints)}`);
  }
}

console.log(
  `\n${missingTotal === 0 ? 'All fonts render' : `${missingTotal} font(s) cannot render`} "${argv.chars}".`,
);
