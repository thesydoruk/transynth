/**
 * Fake Starfield lip tools for tests: `LipGenerator.exe` and `ffxc.exe` are small Node
 * scripts that behave like the real programs (exit 0 on failure included) and run
 * through `nodeToolRunner` instead of Wine.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRunner } from '../ffxanim';
import { STARFIELD_TOOL_FILES } from '../starfieldTools';

/** Writes `FACE` + its argv; with "FAIL" in the text prints an error and writes nothing. */
const FAKE_LIP_GENERATOR = `
const fs = require('node:fs');
const [wav, text, actor, analysis, ...opts] = process.argv.slice(2);
console.log('LipGenerator.exe, Version 1.0.0.1');
if (text.includes('FAIL')) { console.log('Unable to find wav file ' + wav); process.exit(0); }
const out = opts.find((o) => o.startsWith('-OutputFileName:')).slice('-OutputFileName:'.length);
const group = opts.find((o) => o.startsWith('-AnimationGroupName:')).slice('-AnimationGroupName:'.length);
fs.writeFileSync(out, 'FACE' + JSON.stringify({ wav, text, actor, analysis, group, opts }));
`;

/**
 * Reads the project, writes `<out>/<Actor>/x86/<group>/<wav name>.ffxanim` (a valid
 * runtime header) and the log; an animset whose text has "BADBUILD" fails the build.
 */
const FAKE_FFXC = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const log = args.find((a) => a.startsWith('-l=')).slice(3);
const out = args.find((a) => a.startsWith('-o=')).slice(3);
const project = fs.readFileSync(args[args.length - 1], 'utf8');
const actorFile = /facefx_file: (.+)\\r\\n/.exec(project)[1];
const animset = /    - (.+)\\r\\n/.exec(project)[1];
const info = JSON.parse(fs.readFileSync(animset, 'utf8').slice(4));
const actor = path.basename(actorFile, '.facefx');
const name = path.basename(info.wav, '.wav');
if (info.text.includes('BADBUILD')) {
  fs.writeFileSync(log, 'cannot import ' + animset + ' the animation group already exists\\r\\n' +
    '========== Build: 0 succeeded, 1 failed, 0 up-to-date, 0 warnings, 0 bytes written ==========\\r\\n');
  process.exit(0);
}
const body = Buffer.from(JSON.stringify({ actor, group: info.group, name, text: info.text, project }));
const data = Buffer.alloc(12 + body.length);
data.write('__ffx\\0\\0\\x03', 0, 'latin1');
data.writeUInt32LE(data.length, 8);
body.copy(data, 12);
const dir = path.join(out, actor, 'x86', info.group);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, name + '.ffxanim'), data);
fs.writeFileSync(log, 'compiling ' + info.group + '/' + name + '...\\r\\n' +
  '========== Build: 1 succeeded, 0 failed, 0 up-to-date, 0 warnings, ' + data.length + ' bytes written ==========\\r\\n');
`;

/** A complete fake install under `root`: every required file, the two exes as scripts. */
export const writeFakeStarfieldTools = (root: string): void => {
  for (const [dir, files] of Object.entries(STARFIELD_TOOL_FILES)) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(root, dir, file), `fake ${file}`);
  }
  fs.writeFileSync(path.join(root, 'LipGenerator', 'LipGenerator.exe'), FAKE_LIP_GENERATOR);
  fs.writeFileSync(path.join(root, 'FaceFX', 'ffxc.exe'), FAKE_FFXC);
};

/** Runs a fake `.exe` with Node: the scripts above are CommonJS whatever their extension. */
export const nodeToolRunner: ToolRunner = (exe, args, opts) =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [exe, ...args],
      { cwd: opts.cwd, timeout: opts.timeoutMs },
      (err, stdout, stderr) => {
        const failure = err as (Error & { code?: number; killed?: boolean }) | null;
        resolve({
          code: failure ? (failure.code ?? null) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: Boolean(failure?.killed),
        });
      },
    );
  });

/** A minimal RIFF/WAVE file (header only). */
export const tinyWav = (): Buffer => {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36, 4);
  buf.write('WAVEfmt ', 8, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1');
  return buf;
};
