import { execFile as nodeExecFile } from 'node:child_process';

export type ExecFileResult = {
  stdout: string;
  stderr: string;
};

/** Promise wrapper around `execFile` with Windows-friendly defaults. */
export const execFileAsync = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecFileResult> =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      command,
      args,
      {
        cwd: options.cwd,
        windowsHide: true,
        timeout: options.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || stdout || err.message).trim();
          reject(new Error(`${command} failed: ${detail || err.message}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
