/**
 * One file as a `multipart/form-data` body, streamed from disk.
 *
 * Not a `Blob` from `fs.openAsBlob`: for a file over 4 GiB Node reports the
 * blob's size modulo 2^32 (8,521,712,439 bytes came out as 4,226,745,143 on
 * Node 22), the request's Content-Length is built from that size, and the
 * server stops reading there — the upload of Starfield's 8 GB unit hung with
 * exactly that many bytes received. Framing the stream by hand needs no size.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type MultipartFileBody = {
  /** The request's Content-Type, boundary included. */
  contentType: string;
  /** The body: the part's headers, the file's bytes, the closing boundary. */
  chunks: () => AsyncGenerator<Buffer>;
  /** Bytes of the whole body, from the file's real size. */
  length: number;
};

/** A quoted `filename` value: the quote and the line breaks cannot appear in it. */
const quotedFileName = (fileName: string): string =>
  fileName.replace(/"/g, '%22').replace(/[\r\n]+/g, ' ');

export const multipartFileBody = (
  filePath: string,
  mime: string,
  fieldName = 'file',
): MultipartFileBody => {
  const boundary = `----transynth-${crypto.randomBytes(16).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${quotedFileName(path.basename(filePath))}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const size = fs.statSync(filePath).size;

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    length: head.length + size + tail.length,
    chunks: async function* chunks() {
      yield head;
      for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1 << 20 })) {
        yield chunk as Buffer;
      }
      yield tail;
    },
  };
};
