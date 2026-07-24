process.env.DATA_DIR = '/app/data';
const { ensureChampollionInstalled } = await import('/app/src/tools/installTools.ts');
const { execWindowsToolAsync } = await import('/app/src/wine/windowsToolExec.ts');
const champ = await ensureChampollionInstalled();
try {
  await execWindowsToolAsync(champ, [], { timeoutMs: 30_000, arch: 'win64' });
  console.log('Champollion OK');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/No input file given|Usage|Champollion/i.test(msg)) {
    console.log('Champollion OK —', msg.trim().slice(0, 80));
  } else {
    throw err;
  }
}
