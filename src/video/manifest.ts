/**
 * The agent's stand-in for a video file inside a unit upload.
 *
 * A Bink file weighs hundreds of megabytes and changes rarely, so the unit
 * zip carries `<file>.video.json` in its place: what the file is (name, size,
 * sha1) and which machine saw it. The import registers the video from it; the
 * file itself follows through its own upload once the asset exists, and the
 * server reads the tracks out of it then.
 */
import fs from 'node:fs';
import path from 'node:path';

export const VIDEO_MANIFEST_SUFFIX = '.video.json';

export type VideoManifest = {
  fileName: string;
  byteSize: number;
  sha1: string;
  /** The machine the agent runs on, when it says. */
  agentKey?: string;
};

export const videoManifestName = (videoFileName: string): string =>
  `${videoFileName}${VIDEO_MANIFEST_SUFFIX}`;

export const isVideoManifestPath = (filePath: string): boolean =>
  filePath.toLowerCase().endsWith(VIDEO_MANIFEST_SUFFIX);

/** The manifest's content, or null when the JSON is not one. */
export const parseVideoManifest = (raw: unknown): VideoManifest | null => {
  const b = (raw ?? {}) as Record<string, unknown>;
  const fileName = typeof b.fileName === 'string' ? b.fileName.trim() : '';
  if (!fileName || /[\\/]/.test(fileName)) return null;
  if (typeof b.sha1 !== 'string' || !/^[0-9a-f]{40}$/i.test(b.sha1)) return null;
  const byteSize =
    typeof b.byteSize === 'number' && Number.isFinite(b.byteSize) && b.byteSize >= 0
      ? b.byteSize
      : 0;
  return {
    fileName,
    byteSize,
    sha1: b.sha1.toLowerCase(),
    ...(typeof b.agentKey === 'string' && b.agentKey ? { agentKey: b.agentKey } : {}),
  };
};

export const readVideoManifest = (filePath: string): VideoManifest | null => {
  try {
    return parseVideoManifest(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
};

/**
 * The manifests of one mod folder: `<dir>/<videoDir>/*.video.json`, where the
 * video folder is the plugin's `media.videoDir` with or without its `Data/`
 * prefix (a mod folder is laid out like Data).
 */
export const listVideoManifests = (modDir: string, videoDir: string): string[] => {
  const candidates = new Set<string>([
    path.join(modDir, videoDir),
    path.join(modDir, path.basename(videoDir)),
  ]);
  const out: string[] = [];
  for (const dir of candidates) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && isVideoManifestPath(entry.name)) out.push(path.join(dir, entry.name));
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'en'));
};
