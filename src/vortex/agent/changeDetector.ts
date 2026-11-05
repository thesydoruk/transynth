/**
 * Cheap change detection for the watch loop. Vortex writes a mod update as a
 * new top-level folder, so the staging listing plus the stats of the
 * deployment manifest and the plugin list files tell, without walking files,
 * whether anything is worth a full scan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha1Hex } from '../../utils/hash';
import { discoverPluginLoadOrder } from '../pluginsTxt';
import type { VortexExportOrder } from '../types';
import type { AgentConfig } from './config';

export type WatchSnapshot = {
  staging: string;
  order: string;
  takenAt: string;
};

const SKIP_TOP_NAMES = new Set(['.git', 'node_modules', '.transynth-extracted']);

const sig = (lines: string[]): string => sha1Hex([...lines].sort().join('\n'));

export const stagingSignature = (entries: Array<{ name: string; mtimeMs: number }>): string =>
  sig(entries.map((e) => `${e.name.toLowerCase()}\0${Math.trunc(e.mtimeMs)}`));

export const orderFilesSignature = (
  files: Array<{ path: string; size: number; mtimeMs: number }>,
): string => sig(files.map((f) => `${f.path.toLowerCase()}\0${f.size}\0${Math.trunc(f.mtimeMs)}`));

export const unitsSignature = (units: Array<{ unitId: string; contentHash: string }>): string =>
  sig(units.map((u) => `${u.unitId}\0${u.contentHash}`));

export const exportOrderSignature = (order: VortexExportOrder): string =>
  sha1Hex(
    JSON.stringify({
      plugins: order.plugins.map((p) => p.toLowerCase()),
      enabled: (order.enabledPlugins ?? []).map((p) => p.toLowerCase()),
      winners: order.fileWinners.map(
        (w) => `${w.path.toLowerCase()}\0${w.sourceFolder.toLowerCase()}`,
      ),
    }),
  );

export const diffWatchSnapshots = (
  prev: WatchSnapshot | null,
  next: WatchSnapshot,
): { staging: boolean; order: boolean; any: boolean } => {
  const staging = prev?.staging !== next.staging;
  const order = prev?.order !== next.order;
  return { staging, order, any: staging || order };
};

/** Signature of two snapshots as one string, for the state file. */
export const watchSignature = (snapshot: WatchSnapshot): string =>
  `${snapshot.staging}:${snapshot.order}`;

const statOrNull = (file: string): { path: string; size: number; mtimeMs: number } | null => {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? { path: file, size: stat.size, mtimeMs: stat.mtimeMs } : null;
  } catch {
    return null;
  }
};

/** The plugin list files the export order is read from, wherever they live. */
export const orderFilesFor = (config: AgentConfig): string[] => {
  const files = [
    path.join(config.stagingPath, 'vortex.deployment.msgpack'),
    path.join(config.stagingPath, 'vortex.deployment.json'),
  ];
  let source: string | null = null;
  try {
    source = discoverPluginLoadOrder({
      game: config.game,
      stagingPath: config.stagingPath,
      pluginsTxt: config.pluginsTxt,
      vortexProfile: config.vortexProfile,
    }).source;
  } catch {
    source = null;
  }
  if (source) {
    const isDir = (() => {
      try {
        return fs.statSync(source).isDirectory();
      } catch {
        return false;
      }
    })();
    if (isDir) {
      files.push(
        path.join(source, 'plugins.txt'),
        path.join(source, 'Plugins.txt'),
        path.join(source, 'loadorder.txt'),
      );
    } else {
      files.push(source);
    }
  }
  return files;
};

export const readWatchSnapshot = (config: AgentConfig): WatchSnapshot => {
  const entries: Array<{ name: string; mtimeMs: number }> = [];
  for (const entry of fs.readdirSync(config.stagingPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_TOP_NAMES.has(entry.name.toLowerCase())) continue;
    const stat = fs.statSync(path.join(config.stagingPath, entry.name));
    entries.push({ name: entry.name, mtimeMs: stat.mtimeMs });
  }
  const orderFiles = orderFilesFor(config)
    .map(statOrNull)
    .filter((f): f is NonNullable<typeof f> => f != null);
  return {
    staging: stagingSignature(entries),
    order: orderFilesSignature(orderFiles),
    takenAt: new Date().toISOString(),
  };
};
