/**
 * Fixtures for takes named by WEM id: synthetic plugins whose INFO responses
 * carry Starfield's 12-byte `TRDA`, and real audio made with ffmpeg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';
import { resolveFfmpegPath } from '../voiceToolPaths';

const sub = (sig: string, data: Buffer): Buffer => {
  const header = Buffer.alloc(6);
  header.write(sig, 0, 'ascii');
  header.writeUInt16LE(data.length, 4);
  return Buffer.concat([header, data]);
};

const u32 = (value: number): Buffer => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0);
  return buf;
};

const zstring = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf8');

const record = (sig: string, formId: number, subs: Buffer[]): Buffer => {
  const data = Buffer.concat(subs);
  const header = Buffer.alloc(24);
  header.write(sig, 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([header, data]);
};

export type WemResponse = {
  /** `TRDA` "WEM File"; 0 for a response that names none. */
  wemId: number;
  /** `NAM1` text; an empty string writes an empty `NAM1`. */
  text: string;
  /** `TROI` "Original INFO": the response replays that INFO's take. */
  originalInfo?: number;
};

/** Starfield `TRDA`: emotion FormID, WEM file id, emotion-out float — 12 bytes. */
const wemTrda = (wemId: number): Buffer => {
  const data = Buffer.alloc(12);
  data.writeUInt32LE(wemId >>> 0, 4);
  data.writeFloatLE(1, 8);
  return sub('TRDA', data);
};

/** An INFO as Starfield stores it: per response `TRDA`, `TROI`?, `NAM1`, `NAM2`. */
export const wemInfo = (
  formId: number,
  responses: WemResponse[],
  options: { sharedInfo?: number } = {},
): Buffer =>
  record('INFO', formId, [
    ...(options.sharedInfo != null ? [sub('DNAM', u32(options.sharedInfo))] : []),
    ...responses.flatMap((response) => [
      wemTrda(response.wemId),
      ...(response.originalInfo != null ? [sub('TROI', u32(response.originalInfo))] : []),
      sub('NAM1', response.text ? zstring(response.text) : Buffer.alloc(0)),
      sub('NAM2', zstring('')),
    ]),
  ]);

/** An INFO as Fallout 4 stores it: a 20-byte `TRDA` with the response number at offset 4. */
export const fuzInfo = (formId: number, responseNumbers: number[]): Buffer =>
  record(
    'INFO',
    formId,
    responseNumbers.flatMap((number) => {
      const trda = Buffer.alloc(20);
      trda.writeUInt32LE(number, 4);
      return [sub('TRDA', trda), sub('NAM1', zstring(`line ${number}`))];
    }),
  );

export const writePlugin = (file: string, masters: string[], records: Buffer[] = []): void => {
  const tes4 = record(
    'TES4',
    0,
    masters.map((master) => sub('MAST', zstring(master))),
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([tes4, ...records]));
};

export const touch = (file: string, content: string | Buffer = 'x'): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

/** A mono sine WAV of `seconds` at `sampleRate`, made by ffmpeg. */
export const writeToneWav = async (
  file: string,
  seconds: number,
  sampleRate = 24000,
): Promise<string> => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await execFileAsync(resolveFfmpegPath(), [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=330:duration=${seconds}`,
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-sample_fmt',
    's16',
    file,
  ]);
  return file;
};

/**
 * A RIFF/WAVE shell with the given `fmt ` tag and no decodable audio: what a
 * take in a codec without an implementation looks like from the outside.
 */
export const wemWithFormatTag = (formatTag: number): Buffer => {
  const fmt = Buffer.alloc(18);
  fmt.writeUInt16LE(formatTag, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(48000, 4);
  const chunk = (id: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const body = Buffer.concat([chunk('fmt ', fmt), chunk('data', Buffer.alloc(64))]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'latin1');
  return Buffer.concat([header, body]);
};
