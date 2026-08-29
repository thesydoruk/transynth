import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { ensureDir } from '../../utils/file';
import type { ZipPackEntry } from './exportTypes';

/** Pack loose localization files into a stored (uncompressed) ZIP buffer. */
export const packFilesToZip = async (files: ZipPackEntry[]): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { store: true });
    archive.on('error', reject);
    archive.pipe(passthrough);

    for (const file of files) {
      if (file.data) {
        archive.append(file.data, { name: file.name });
        continue;
      }
      if (file.absPath) {
        archive.file(file.absPath, { name: file.name });
        continue;
      }
      reject(new Error(`ZIP entry "${file.name}" has no data source`));
      return;
    }

    archive.finalize();
  });

/** Stream a ZIP to disk — never buffers the finished archive in RAM. */
export const packFilesToZipPath = async (
  files: ZipPackEntry[],
  destPath: string,
): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    ensureDir(path.dirname(destPath));
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { store: true });
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', () => resolve(archive.pointer()));
    archive.pipe(output);

    for (const file of files) {
      if (file.data) {
        archive.append(file.data, { name: file.name });
        continue;
      }
      if (file.absPath) {
        archive.file(file.absPath, { name: file.name });
        continue;
      }
      reject(new Error(`ZIP entry "${file.name}" has no data source`));
      return;
    }

    archive.finalize();
  });

/** Zip a staging directory to `destPath` without a wrapper folder. */
export const zipDirectoryToPath = async (srcDir: string, destPath: string): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    ensureDir(path.dirname(destPath));
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { store: true });
    archive.on('error', reject);
    output.on('error', reject);
    output.on('close', () => resolve(archive.pointer()));
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
