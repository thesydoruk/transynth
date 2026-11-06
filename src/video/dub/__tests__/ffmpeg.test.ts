import { describe, expect, it } from '@jest/globals';
import { buildMixFilterGraph, parseLoudnormJson } from '../ffmpeg';

describe('dub ffmpeg helpers', () => {
  it('reads the integrated loudness out of loudnorm output', () => {
    const stderr = `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-19.73",\n\t"input_tp" : "-3.10"\n}\n`;
    expect(parseLoudnormJson(stderr)).toBe(-19.73);
    expect(parseLoudnormJson('{"input_i":"-inf"}')).toBeNull();
    expect(parseLoudnormJson('nothing here')).toBeNull();
  });

  it('delays every take to its start, sums them at the narration loudness, then adds the background', () => {
    const graph = buildMixFilterGraph(
      [
        { wav: 'a.wav', startS: 0.5 },
        { wav: 'b.wav', startS: 12.25 },
      ],
      { speechLufs: -19.7, hasBackground: true },
    );
    expect(graph.split(';\n')).toEqual([
      '[1:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,adelay=500|500[t0]',
      '[2:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,adelay=12250|12250[t1]',
      '[t0][t1]amix=inputs=2:normalize=0:dropout_transition=0,loudnorm=I=-19.7:TP=-1.5:LRA=11[speech]',
      '[0:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo[bg]',
      '[bg][speech]amix=inputs=2:normalize=0:dropout_transition=0:duration=first[out]',
    ]);
  });

  it('copes with a single take and no background or loudness reference', () => {
    const graph = buildMixFilterGraph([{ wav: 'a.wav', startS: 2 }], {
      speechLufs: null,
      hasBackground: false,
    });
    expect(graph.split(';\n')).toEqual([
      '[0:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,adelay=2000|2000[t0]',
      '[t0]anull[speech]',
      '[speech]anull[out]',
    ]);
  });
});
