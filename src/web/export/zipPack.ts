import { PassThrough } from 'node:stream';
import archiver from 'archiver';
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
