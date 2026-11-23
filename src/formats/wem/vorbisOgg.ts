/**
 * Wwise Vorbis ⇄ Ogg Vorbis, the whole stream.
 *
 * Reading a take rebuilds the Ogg Vorbis file any decoder plays: the three
 * headers Wwise dropped or shortened, the audio packets with their window bits
 * back, and page positions that end the stream on the sample the take's header
 * states. Writing one is the inverse, applied to what libvorbis encoded — which
 * works because every codebook libvorbis uses is in the table the Wwise runtime
 * carries: measured for mono at every quality level of 44.1 kHz, six bitrates
 * and four other sample rates, 27 settings and not one codebook missing.
 * `rewriteVorbisSetup` refuses a setup with a codebook that is not there.
 */
import { buildOggPage, OGG_FLAG_BOS, OGG_FLAG_EOS, readOggPackets } from './ogg';
import { wwiseCodebookLibrary } from './vorbisCodebook';
import {
  audioPacketsToStandard,
  audioPacketsToWwise,
  buildCommentHeader,
  buildIdentificationHeader,
  packetBlockFlags,
  packetSampleCounts,
  parseIdentificationHeader,
} from './vorbisPackets';
import { rewriteVorbisSetup } from './vorbisSetup';
import { buildVorbisWem, type VorbisWem } from './vorbisWem';

const SERIAL = 1;
/** Lacing values one Ogg page holds. */
const PAGE_SEGMENTS = 255;

/**
 * Decoder memory the runtime is told to reserve for a setup (`fmt ` +0x34 and
 * +0x38), by the setup's structural fingerprint. Wwise's encoder computes the
 * two numbers; here they are the ones the game's own takes state. Every mono
 * take sampled states 15,492 and 15,892 — 3,609 takes at three sample rates,
 * whose setups differ in floor curve positions and residue ranges and in
 * nothing else — so the numbers follow the structure, not those tuning values,
 * which the fingerprint leaves out. libvorbis quality 1 to 2 has that
 * structure.
 */
const DECODER_MEMORY_BY_SHAPE = new Map<number, readonly [number, number]>([
  [0xf45f9ef5, [15492, 15892]],
]);

const segmentsOf = (packet: Buffer): number => Math.floor(packet.length / 255) + 1;

/**
 * Audio pages: whole packets, each page stamped with the sample position it
 * ends at. The first page stops after two packets so that the stream never
 * ends on its first audio page: ffmpeg times a stream from that page, and
 * trims the end wrongly when it is also the last.
 */
const audioPages = (packets: readonly Buffer[], ends: readonly number[]): Buffer[] => {
  const pages: Buffer[] = [];
  let from = 0;
  while (from < packets.length) {
    const limit = from === 0 ? Math.min(2, packets.length - 1) : packets.length - from;
    let to = from;
    let segments = 0;
    while (to - from < Math.max(1, limit) && segments + segmentsOf(packets[to]!) <= PAGE_SEGMENTS) {
      segments += segmentsOf(packets[to]!);
      to++;
    }
    if (to === from) throw new Error('Vorbis packet too large for an Ogg page');
    const flags = to === packets.length ? OGG_FLAG_EOS : 0;
    pages.push(
      buildOggPage(SERIAL, pages.length + 2, BigInt(ends[to - 1]!), flags, packets.slice(from, to)),
    );
    from = to;
  }
  return pages;
};

/** The take as an Ogg Vorbis file that decodes to exactly `wem.samples` samples. */
export const vorbisWemToOgg = (wem: VorbisWem): Buffer => {
  const setup = rewriteVorbisSetup(wem.setup, 'toStandard', {
    channels: wem.channels,
    library: wwiseCodebookLibrary(),
  });
  const counts = packetSampleCounts(
    packetBlockFlags(wem.packets, setup.modes, false),
    wem.blockSizeBits,
  );
  const audio = audioPacketsToStandard(wem.packets, setup.modes);

  // Where each packet's output ends, cut at the take's length. A packet that
  // starts past that length adds nothing and is left out, so the stream's last
  // packet is the one the end falls in — the only trim an Ogg page can express.
  const ends: number[] = [];
  let decoded = 0;
  for (const count of counts) {
    if (ends.length > 1 && decoded >= wem.samples) break;
    decoded += count;
    ends.push(Math.min(decoded, wem.samples));
  }
  if (decoded < wem.samples) {
    throw new Error(
      `Wwise Vorbis take states ${wem.samples} samples but its packets decode to ${decoded}`,
    );
  }

  const identification = buildIdentificationHeader({
    channels: wem.channels,
    sampleRate: wem.sampleRate,
    bitrate: wem.bytesPerSecond * 8,
    blockSizeBits: wem.blockSizeBits,
  });
  return Buffer.concat([
    buildOggPage(SERIAL, 0, 0n, OGG_FLAG_BOS, [identification]),
    buildOggPage(SERIAL, 1, 0n, 0, [buildCommentHeader(), setup.packet]),
    ...audioPages(audio.slice(0, ends.length), ends),
  ]);
};

/**
 * A mono Ogg Vorbis file, as libvorbis writes it, as a take. Throws when the
 * stream cannot be one: a codebook outside the Wwise table, or a setup whose
 * decoder memory is not known.
 */
export const oggVorbisToWem = (ogg: Buffer): Buffer => {
  const { packets, finalGranule } = readOggPackets(ogg);
  const [identificationPacket, , setupPacket, ...audio] = packets;
  if (!identificationPacket || !setupPacket || audio.length === 0) {
    throw new Error('Ogg Vorbis stream has no audio');
  }
  const identification = parseIdentificationHeader(identificationPacket);
  if (identification.channels !== 1) {
    throw new Error(
      `Only mono takes are written; the stream has ${identification.channels} channels`,
    );
  }
  const setup = rewriteVorbisSetup(setupPacket, 'toWwise', {
    channels: 1,
    library: wwiseCodebookLibrary(),
  });
  const decoderMemory = DECODER_MEMORY_BY_SHAPE.get(setup.shape);
  if (!decoderMemory) {
    throw new Error(
      `Vorbis setup (structure ${setup.shape.toString(16)}, ${identification.sampleRate} Hz) is not one the game's own takes use; the decoder memory it needs is unknown`,
    );
  }
  return buildVorbisWem({
    sampleRate: identification.sampleRate,
    samples: Number(finalGranule),
    blockSizeBits: identification.blockSizeBits,
    setup: setup.packet,
    modes: setup.modes,
    packets: audioPacketsToWwise(audio, setup.modes),
    decoderMemory,
  });
};
