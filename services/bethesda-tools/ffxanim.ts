/**
 * Starfield lip animation: WAV + text → `.animset` (LipGenerator) → `.ffxanim` (ffxc).
 *
 * The same two console programs the Creation Kit runs, one take per call:
 *
 *   LipGenerator <wav> "<text>" <actor.facefx> <GenesisDefault.facefx>
 *     -OutputFileName:<name>.animset -AnimationGroupName:<group>
 *   ffxc -p=x86 -Wno-empty-bone-pose -Wno-unused-track -Wno-snap --time
 *     -l=<log> -o=<outdir> <name>.ffxcproj
 *
 * ffxc writes `<outdir>/<ActorName>/x86/<group>/<name>.ffxanim`; the animation is
 * named after the WAV file. Both tools exit 0 when they fail, so every step is judged
 * by its output file (and ffxc's log line `Build: N succeeded, M failed`), and an
 * error carries what the tool printed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { FaceFxActor, StarfieldToolPaths } from './starfieldTools';

export type ToolRun = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Run one tool (a Windows .exe) with `args`; resolves with whatever happened. */
export type ToolRunner = (
  exe: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<ToolRun>;

/** How long output may still arrive after the process exits. */
const EXIT_GRACE_MS = 300;
const MAX_OUTPUT = 1024 * 1024;

/**
 * `wine <exe> …` in one prefix; never rejects on a failed run, only reports it.
 *
 * The run ends when the process exits, not when its output pipes close: the first
 * program in a prefix starts Wine's resident services (services.exe, winedevice.exe,
 * …), which inherit those pipes and keep them open for as long as the wineserver
 * lives. Waiting for the pipes (as `execFile` does) held that first take until the
 * timeout although LipGenerator had finished in half a second.
 */
export const wineToolRunner =
  (wine: string, env: NodeJS.ProcessEnv): ToolRunner =>
  (exe, args, opts) =>
    new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let done = false;
      const child = spawn(wine, [exe, ...args], {
        env,
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const finish = (code: number | null, error = ''): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // Left open for the resident services (closing them could SIGPIPE a later write),
        // but no longer anything to wait for.
        for (const pipe of [child.stdout, child.stderr]) {
          pipe.removeAllListeners('data');
          (pipe as Readable & { unref?: () => void }).unref?.();
        }
        resolve({ code, stdout, stderr: stderr || error, timedOut });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => finish(null, err.message));
      child.on('close', (code) => finish(code));
      child.on('exit', (code) => {
        setTimeout(() => finish(code), EXIT_GRACE_MS).unref();
      });
    });

/** Group and animation name: letters, digits and `_` (a WEM id such as `00ae4a02`). */
export const FFXANIM_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

export const lipGeneratorArgs = (
  tools: StarfieldToolPaths,
  toolPath: (p: string) => string,
  job: { wav: string; text: string; actor: FaceFxActor; animset: string; group: string },
): string[] => [
  toolPath(job.wav),
  job.text,
  toolPath(tools.actor(job.actor)),
  toolPath(tools.analysisActor),
  `-OutputFileName:${toolPath(job.animset)}`,
  `-AnimationGroupName:${job.group}`,
];

/** The `.ffxcproj` the Creation Kit writes (YAML, CRLF): one actor, its animsets. */
export const ffxcProjectText = (actorFile: string, animsets: readonly string[]): string =>
  [
    'version: 10300',
    'items:',
    ` - facefx_file: ${actorFile}`,
    '   mount_files:',
    ...animsets.map((animset) => `    - ${animset}`),
    '',
  ].join('\r\n');

export const ffxcArgs = (log: string, outDir: string, project: string): string[] => [
  '-p=x86',
  '-Wno-empty-bone-pose',
  '-Wno-unused-track',
  '-Wno-snap',
  '--time',
  `-l=${log}`,
  `-o=${outDir}`,
  project,
];

/** `Build: 1 succeeded, 0 failed, …` from ffxc's log, or null when the line is absent. */
export const parseFfxcBuildSummary = (
  log: string,
): { succeeded: number; failed: number } | null => {
  const match = /Build:\s*(\d+)\s+succeeded,\s*(\d+)\s+failed/.exec(log);
  return match ? { succeeded: Number(match[1]), failed: Number(match[2]) } : null;
};

/** Every `.ffxanim` under `dir`, the one at `…/<group>/<name>.ffxanim` first. */
export const findFfxanimFiles = (dir: string, group: string, name: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const found = (fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((rel) => rel.toLowerCase().endsWith('.ffxanim'))
    .map((rel) => path.join(dir, rel));
  const wanted = (file: string): boolean =>
    path.basename(file).toLowerCase() === `${name}.ffxanim`.toLowerCase() &&
    path.basename(path.dirname(file)).toLowerCase() === group.toLowerCase();
  return [...found.filter(wanted), ...found.filter((file) => !wanted(file))];
};

/** FaceFX runtime files start `__ffx\0` and give their own length at offset 8. */
export const isFfxRuntimeFile = (data: Buffer): boolean =>
  data.length >= 12 &&
  data.toString('latin1', 0, 6) === '__ffx\0' &&
  data.readUInt32LE(8) === data.length;

/** A failed step, with the tool's own output in the message. */
export class FfxanimToolError extends Error {
  constructor(
    readonly tool: 'LipGenerator' | 'ffxc',
    reason: string,
    readonly output: string,
  ) {
    super(output ? `${tool}: ${reason}\n${output}` : `${tool}: ${reason}`);
    this.name = 'FfxanimToolError';
  }
}

const TAIL_LINES = 15;

const tail = (text: string, lines = TAIL_LINES): string =>
  text.replace(/\0/g, '').trim().split(/\r?\n/).slice(-lines).join('\n');

const runReason = (run: ToolRun, timeoutMs: number, missing: string): string =>
  run.timedOut ? `timed out after ${timeoutMs} ms` : `${missing} (exit code ${run.code ?? '?'})`;

export type FfxanimJob = {
  tools: StarfieldToolPaths;
  /** Private, empty folder on the container's own filesystem. */
  workDir: string;
  wav: Buffer;
  /** LipGenerator's text argument, already prepared (never empty). */
  text: string;
  actor: FaceFxActor;
  /** WAV file name, animation name and group name. */
  name: string;
  run: ToolRunner;
  /** Host path → the path the tools see (`Z:\…` under Wine). */
  toolPath: (p: string) => string;
  timeoutMs: number;
};

export type FfxanimResult = { data: Buffer; lipGeneratorMs: number; ffxcMs: number };

export const generateFfxanim = async (job: FfxanimJob): Promise<FfxanimResult> => {
  if (!FFXANIM_NAME_RE.test(job.name)) throw new Error(`unsafe animation name: ${job.name}`);
  const wav = path.join(job.workDir, `${job.name}.wav`);
  const animset = path.join(job.workDir, `${job.name}.animset`);
  const project = path.join(job.workDir, `${job.name}.ffxcproj`);
  const log = path.join(job.workDir, 'ffxc.log');
  const outDir = path.join(job.workDir, 'out');
  fs.writeFileSync(wav, job.wav);
  fs.mkdirSync(outDir);
  const runOpts = { cwd: job.workDir, timeoutMs: job.timeoutMs };

  let started = Date.now();
  const lipArgs = lipGeneratorArgs(job.tools, job.toolPath, {
    wav,
    text: job.text,
    actor: job.actor,
    animset,
    group: job.name,
  });
  const lipRun = await job.run(job.tools.lipGenerator, lipArgs, runOpts);
  const lipGeneratorMs = Date.now() - started;
  const animsetOk =
    fs.existsSync(animset) && fs.readFileSync(animset).subarray(0, 4).toString('latin1') === 'FACE';
  if (!animsetOk) {
    throw new FfxanimToolError(
      'LipGenerator',
      runReason(lipRun, job.timeoutMs, 'wrote no .animset'),
      tail(`${lipRun.stdout}\n${lipRun.stderr}`),
    );
  }

  const actorFile = job.toolPath(job.tools.actor(job.actor));
  fs.writeFileSync(project, ffxcProjectText(actorFile, [job.toolPath(animset)]));
  started = Date.now();
  const ffxcRun = await job.run(
    job.tools.ffxc,
    ffxcArgs(job.toolPath(log), job.toolPath(outDir), job.toolPath(project)),
    runOpts,
  );
  const ffxcMs = Date.now() - started;
  const logText = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const summary = parseFfxcBuildSummary(logText);
  const output = findFfxanimFiles(outDir, job.name, job.name)[0];
  const data = output ? fs.readFileSync(output) : null;
  if (!data || !isFfxRuntimeFile(data) || (summary && summary.failed > 0)) {
    const reason = !data
      ? runReason(ffxcRun, job.timeoutMs, 'wrote no .ffxanim')
      : summary && summary.failed > 0
        ? `build reports ${summary.failed} failed`
        : 'wrote a .ffxanim that is not a FaceFX runtime file';
    throw new FfxanimToolError(
      'ffxc',
      reason,
      tail(`${logText}\n${ffxcRun.stderr}`) || tail(ffxcRun.stdout),
    );
  }
  return { data, lipGeneratorMs, ffxcMs };
};
