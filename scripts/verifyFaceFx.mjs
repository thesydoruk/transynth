process.env.DATA_DIR = '/app/data';
const fs = await import('node:fs');
const path = await import('node:path');
const { execFileSync } = await import('node:child_process');

const tmp = '/app/data/tmp-facefx';
fs.mkdirSync(tmp, { recursive: true });
const wav = path.join(tmp, 't.wav');
const fo4 = path.join(tmp, 't.fo4.wav');
const lip = path.join(tmp, 't.lip');
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-acodec', 'pcm_s16le', wav], { stdio: 'ignore' });

const { convertToFo4Wav } = await import('/app/src/voice/ffmpegAudio.ts');
const { generateLipFile } = await import('/app/src/voice/faceFx/index.ts');
await convertToFo4Wav(wav, fo4);
await generateLipFile('fo4', fo4, lip, 'Hello test');
console.log('FaceFX OK', fs.statSync(lip).size);
fs.rmSync(tmp, { recursive: true, force: true });
