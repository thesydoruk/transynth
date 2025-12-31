import { execChild } from './runExport.js';
import path from 'path';

export async function runXEditApply(xeditExe: string, applierPas: string, pluginPath: string, inCsv: string) {
  const pluginName = path.basename(pluginPath);
  const args = [
    '-quick', '-autoload',
    `-fo:"${pluginPath}"`,
    '-app:FO4Edit',
    `-script:"${applierPas}"`,
    `-Argument:"${pluginName}|${inCsv}"`
  ];
  await execChild(xeditExe, args);
}
