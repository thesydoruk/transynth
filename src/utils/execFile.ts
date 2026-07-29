import { execFile as nodeExecFile } from 'node:child_process';

export type ExecFileResult = {
  stdout: string;
  stderr: string;
};

/** Promise wrapper around `execFile` with Windows-friendly defaults. */
export const execFileAsync = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecFileResult> =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        timeout: options.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || stdout || err.message).trim();
          // A timeout kill usually leaves no output, so name it before the noisy
          // "Command failed: …" text that `execFile` puts in `err.message`.
          const timedOut = Boolean(err.killed) && options.timeoutMs !== undefined;
          const reason = timedOut ? `timed out after ${options.timeoutMs}ms: ${detail}` : detail;
          reject(new Error(`${command} failed: ${reason || err.message}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
