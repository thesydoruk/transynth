import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import { request } from 'undici';

export const extractZip = (archivePath: string, outDir: string): Promise<void> =>
  extractArchive(archivePath, outDir);

export const extractArchive = (archivePath: string, outDir: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, outDir, {
      $bin: path7za,
      yes: true,
      recursive: true,
    });
    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });

export const findFileRecursive = (rootDir: string, fileName: string): string | null => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileRecursive(fullPath, fileName);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath;
    }
  }

  return null;
};

export const copyFileSafe = (fromPath: string, toPath: string): void => {
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
};

export const copyDirectory = (fromDir: string, toDir: string): void => {
  fs.mkdirSync(toDir, { recursive: true });
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const src = path.join(fromDir, entry.name);
    const dest = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
};

export const downloadFile = async (url: string, destPath: string): Promise<void> => {
  const response = await request(url, { maxRedirections: 5 });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Download failed: HTTP ${response.statusCode} for ${url}`);
  }
  if (!response.body) {
    throw new Error(`Download failed: empty body for ${url}`);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await pipeline(response.body, createWriteStream(destPath));
};
