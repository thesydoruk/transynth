process.env.DATA_DIR = '/app/data';
const fs = await import('node:fs');
const path = await import('node:path');
const { execFileSync } = await import('node:child_process');

const tmp = '/app/data/tmp-xwma';
fs.mkdirSync(tmp, { recursive: true });
const wav = path.join(tmp, 't.wav');
const fo4 = path.join(tmp, 't.fo4.wav');
const xwm = path.join(tmp, 't.xwm');
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-acodec', 'pcm_s16le', wav], { stdio: 'ignore' });

const { convertToFo4Wav } = await import('/app/src/voice/ffmpegAudio.ts');
const { encodeWavToXwm } = await import('/app/src/voice/xwmEncode.ts');
await convertToFo4Wav(wav, fo4);
await encodeWavToXwm(fo4, xwm);
console.log('xWMA OK', fs.statSync(xwm).size);
fs.rmSync(tmp, { recursive: true, force: true });
