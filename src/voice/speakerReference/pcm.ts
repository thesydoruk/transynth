import fs from 'node:fs';

export type ReferencePcm = {
  samples: Int16Array;
  sampleRate: number;
};

/** Read mono PCM from a standard 16-bit WAV file. */
export const readPcmFromWav = (wavPath: string): ReferencePcm => {
  const buf = fs.readFileSync(wavPath);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`Not a WAV file: ${wavPath}`);
  }

  let offset = 12;
  let sampleRate = 22_050;
  let bitsPerSample = 16;
  let channels = 1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ') {
      channels = buf.readUInt16LE(chunkStart + 2);
      sampleRate = buf.readUInt32LE(chunkStart + 4);
      bitsPerSample = buf.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      dataSize = chunkSize;
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV format: ${wavPath}`);
  }

  const bytesPerSample = (bitsPerSample / 8) * channels;
  const sampleCount = Math.floor(dataSize / bytesPerSample);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * bytesPerSample);
  }
  return { samples, sampleRate };
};
