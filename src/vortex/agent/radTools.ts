/**
 * The RAD Video Tools, fetched and unpacked by the agent itself.
 *
 * Bink 2 is written by nothing but RAD's own tools, which ship as one
 * download: a 7-Zip archive (password `RAD`, printed next to the link on the
 * download page) holding an NSIS installer that holds `radvideo64.exe`. Both
 * layers open with 7-Zip, so the agent unpacks them in-process (7-Zip compiled
 * to WASM) and never runs the installer: the one executable lands in the
 * agent's data folder. The tools are free for non-commercial use.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** RAD's permanent download link for the current tools. */
export const RAD_TOOLS_URL = 'https://www.radgametools.com/down/Bink/RADTools.7z';
/** Stated next to the link on the download page; it is not a secret. */
const RAD_TOOLS_ARCHIVE_PASSWORD = 'RAD';
export const RAD_VIDEO_EXE = 'radvideo64.exe';
const INSTALLER_NAME = 'radtools.exe';
const MIN_ARCHIVE_BYTES = 100_000;

/** The executable, if the folder holds one. */
export const findRadVideoExe = (toolsDir: string): string | null => {
  const exe = path.join(toolsDir, RAD_VIDEO_EXE);
  return fs.existsSync(exe) ? exe : null;
};

/** Run 7-Zip once with a real folder mounted at `/work`; throws when it fails. */
export type SevenZipRunner = (args: string[], mountRoot: string) => Promise<void>;

export const runSevenZip: SevenZipRunner = async (args, mountRoot) => {
  const { default: SevenZip } = await import('7z-wasm');
  const errors: string[] = [];
  const sz = await SevenZip({
    print: () => undefined,
    printErr: (line: string) => {
      if (line.trim()) errors.push(line.trim());
    },
  });
  sz.FS.mkdir('/work');
  sz.FS.mount(sz.NODEFS, { root: mountRoot }, '/work');
  sz.FS.chdir('/work');
  try {
    sz.callMain(args);
  } catch (err) {
    // Emscripten reports exit() as an exception carrying the status.
    const status = (err as { status?: number }).status;
    if (status === 0) return;
    throw new Error(`7-Zip ${args[0]} failed: ${errors.join(' ') || String(err)}`);
  }
};

export type InstallRadToolsOptions = {
  toolsDir: string;
  fetchImpl?: typeof fetch;
  sevenZip?: SevenZipRunner;
  log?: (line: string) => void;
};

/**
 * Download the tools and unpack `radvideo64.exe` into `toolsDir`; returns its
 * path. Work happens in a temp folder and the executable is moved into place
 * last, so a failed download never leaves half a tool where the agent looks.
 */
export const installRadVideoTools = async (opts: InstallRadToolsOptions): Promise<string> => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sevenZip = opts.sevenZip ?? runSevenZip;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-radtools-'));
  try {
    opts.log?.(`downloading ${RAD_TOOLS_URL}`);
    const res = await fetchImpl(RAD_TOOLS_URL);
    if (!res.ok || !res.body) throw new Error(`RAD tools download failed: HTTP ${res.status}`);
    const archive = path.join(work, 'RADTools.7z');
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(archive));
    const bytes = fs.statSync(archive).size;
    if (bytes < MIN_ARCHIVE_BYTES) throw new Error(`RAD tools download is only ${bytes} bytes`);
    opts.log?.(`unpacking ${(bytes / 1048576).toFixed(1)} MiB`);

    await sevenZip(
      ['x', '-y', `-p${RAD_TOOLS_ARCHIVE_PASSWORD}`, '/work/RADTools.7z', '-o/work/step1'],
      work,
    );
    if (!fs.existsSync(path.join(work, 'step1', INSTALLER_NAME))) {
      throw new Error(`RAD tools archive holds no ${INSTALLER_NAME}`);
    }
    await sevenZip(['x', '-y', `/work/step1/${INSTALLER_NAME}`, '-o/work/step2'], work);
    const exe = path.join(work, 'step2', RAD_VIDEO_EXE);
    if (!fs.existsSync(exe)) throw new Error(`RAD tools installer holds no ${RAD_VIDEO_EXE}`);

    fs.mkdirSync(opts.toolsDir, { recursive: true });
    const dest = path.join(opts.toolsDir, RAD_VIDEO_EXE);
    fs.copyFileSync(exe, `${dest}.part`);
    fs.renameSync(`${dest}.part`, dest);
    opts.log?.(`${RAD_VIDEO_EXE} ready in ${opts.toolsDir}`);
    return dest;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

/** The executable, installing the tools first when the folder has none. */
export const ensureRadVideoExe = (opts: InstallRadToolsOptions): Promise<string> => {
  const found = findRadVideoExe(opts.toolsDir);
  return found ? Promise.resolve(found) : installRadVideoTools(opts);
};
