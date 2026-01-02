import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function runXEditExport(xeditExe: string, exporterPas: string, pluginPath: string, outCsv: string, locale?: string) {
  const pluginName = path.basename(pluginPath);
  const args: string[] = [];
  if (locale) args.push(`-l:${locale}`);
  args.push(
    '-quick', '-autoload',
    `-fo:"${pluginPath}"`,
    '-app:FO4Edit',
    `-script:"${exporterPas}"`,
    `-Argument:"${pluginName}|${outCsv}"`
  );
  await execChild(xeditExe, args);
}

/**
 * Export text for a specific locale via xEdit.
 * Returns true if the export produced a valid CSV with data rows.
 */
export async function exportForLocale(xeditExe: string, exporterPas: string, pluginPath: string, locale: string, outCsv: string): Promise<boolean> {
  await runXEditExport(xeditExe, exporterPas, pluginPath, outCsv, locale);
  try {
    const stat = fs.statSync(outCsv);
    if (stat.size === 0) return false;
    const lines = fs.readFileSync(outCsv, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.length > 1;
  } catch {
    return false;
  }
}

export async function execChild(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { shell: false, stdio: 'inherit' });
    p.on('error', err => reject(new Error(`Failed to start ${cmd}: ${err.message}`)));
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}
