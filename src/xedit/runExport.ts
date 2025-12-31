import { spawn } from 'child_process';
import path from 'path';

export async function runXEditExport(xeditExe: string, exporterPas: string, pluginPath: string, outCsv: string) {
  const pluginName = path.basename(pluginPath);
  const args = [
    '-quick', '-autoload',
    `-fo:"${pluginPath}"`,
    '-app:FO4Edit',
    `-script:"${exporterPas}"`,
    `-Argument:"${pluginName}|${outCsv}"`
  ];
  await execChild(xeditExe, args);
}

export async function execChild(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { shell: false, stdio: 'inherit' });
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}
