#!/usr/bin/env tsx
/**
 * getXEdit.ts
 *
 * Goal
 * ----
 * Automatically download xEdit (FO4Edit/SSEEdit/xEdit) from GitHub Releases and (optionally) extract it.
 * This helps make the project reproducible without manual browser steps.
 *
 * What it does
 * ------------
 * - Queries GitHub Releases for the xEdit project (by default TES5Edit/TES5Edit).
 * - Picks either the latest or a specific tag (--tag vX.Y.Z).
 * - Chooses an asset matching your requested "family" (fo4/sse/starfield/xedit) and architecture.
 *   Historically, releases provide multiple archives like:
 *     - FO4Edit_*_Win64.zip (or .7z)
 *     - SSEEdit_*_Win64.zip
 *     - xEdit_*_Win64.zip
 * - Downloads the archive into a target directory (--dest).
 * - Optionally extracts the archive (--extract). If you have 7-Zip binaries available (via `7zip-bin`),
 *   it will extract .7z/.zip automatically. Otherwise it just leaves the archive on disk.
 *
 * Usage
 * -----
 * # Latest FO4Edit → ./tools/xedit
 * tsx scripts/getXEdit.ts --family fo4 --dest ./tools/xedit --extract
 *
 * # Specific version tag and plain download (no extract)
 * tsx scripts/getXEdit.ts --family xedit --tag v4.1.5 --dest ./tools/xedit
 *
 * # SSEEdit latest, custom destination
 * tsx scripts/getXEdit.ts --family sse --dest "D:\\Tools\\xEdit" --extract
 *
 * Options
 * -------
 * --family        One of: fo4, sse, starfield, xedit (default: fo4).
 * --tag           Optional GitHub tag (e.g., v4.1.5). If omitted, uses the latest release.
 * --repo          GitHub repo in owner/name form (default: TES5Edit/TES5Edit).
 * --dest          Destination directory for downloads/extraction (default: ./tools/xedit).
 * --extract       If present, attempts to extract archive into --dest/xedit (subfolder).
 * --token         Optional GitHub token to avoid rate limits (uses env GITHUB_TOKEN if set).
 *
 * Notes
 * -----
 * - We do not hardcode a specific asset name; instead we score assets by family + Win64 and archive extension.
 * - If multiple candidates exist, the first best-scoring is chosen. You can override with --family or --tag.
 * - On Linux/macOS you will run xEdit under Wine; this script still downloads the Windows build.
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fetch } from 'undici';
import { fullArchive } from 'node-7z-archive';
import { log } from '../src/logger.js';

const streamPipeline = promisify(pipeline);

type GitHubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
};

type GitHubRelease = {
  tag_name: string;
  assets: GitHubAsset[];
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
};

const argv = await yargs(hideBin(process.argv))
  .option('family', { type: 'string', default: 'fo4', choices: ['fo4','sse','starfield','xedit'] as const, desc: 'Which xEdit flavor to prefer' })
  .option('tag',    { type: 'string', desc: 'GitHub tag (e.g., v4.1.5); if omitted, uses latest' })
  .option('repo',   { type: 'string', default: 'TES5Edit/TES5Edit', desc: 'GitHub repo (owner/name)' })
  .option('dest',   { type: 'string', default: './tools/xedit', desc: 'Destination directory' })
  .option('extract',{ type: 'boolean', default: false, desc: 'Extract after download (requires 7zip-bin)' })
  .option('token',  { type: 'string', desc: 'GitHub token; or set env GITHUB_TOKEN' })
  .strict()
  .parse();

const GH_TOKEN = (argv.token as string) || process.env.GITHUB_TOKEN || '';

function headers() {
  const h: Record<string,string> = {
    'User-Agent': 'storywealth-localizer-node',
    'Accept': 'application/vnd.github+json'
  };
  if (GH_TOKEN) h['Authorization'] = `Bearer ${GH_TOKEN}`;
  return h;
}

function assetScore(name: string, family: string) {
  // Higher is better. Favor correct family, Win64, known archive types.
  const n = name.toLowerCase();
  let score = 0;
  // family hint
  if (family === 'fo4' && n.includes('fo4edit')) score += 100;
  if (family === 'sse' && (n.includes('sseedit') || n.includes('xedit'))) score += 100;
  if (family === 'starfield' && n.includes('sfedit')) score += 100; // in case SFEdit naming appears
  if (family === 'xedit' && n.includes('xedit')) score += 90;
  // architecture
  if (n.includes('win64') || n.includes('x64') || n.includes('64')) score += 30;
  // archive type
  if (n.endsWith('.7z')) score += 10;
  if (n.endsWith('.zip')) score += 8;
  return score;
}

async function getLatestRelease(repo: string): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`GitHub latest failed: ${r.status} ${r.statusText}`);
  return (await r.json()) as GitHubRelease;
}

async function getTaggedRelease(repo: string, tag: string): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`GitHub tag fetch failed: ${r.status} ${r.statusText}`);
  return (await r.json()) as GitHubRelease;
}

async function download(url: string, outFile: string) {
  const r = await fetch(url, { headers: headers() });
  if (!r.ok || !r.body) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const fileStream = fs.createWriteStream(outFile);
  await streamPipeline(r.body as any, fileStream);
}

(async () => {
  const repo = argv.repo as string;
  const family = argv.family as string;
  const dest = path.resolve(argv.dest as string);
  fs.mkdirSync(dest, { recursive: true });

log.info(`[xedit] repo=${repo} family=${family} dest=${dest} tag=${argv.tag || 'latest'}`);

  const rel = argv.tag ? await getTaggedRelease(repo, argv.tag as string) : await getLatestRelease(repo);
  if (!rel.assets || rel.assets.length === 0) {
    throw new Error(`Release has no assets (tag=${rel.tag_name})`);
  }

  // Pick best asset for our family
  const sorted = rel.assets
    .map(a => ({ a, score: assetScore(a.name, family) }))
    .sort((x, y) => y.score - x.score);

  if (sorted[0].score <= 0) {
    log.warn('[xedit] No family-specific asset detected; falling back to the first asset.');
  }

  const chosen = sorted[0].a;
  const outFile = path.join(dest, chosen.name);

  log.info(`[xedit] release=${rel.tag_name} asset=${chosen.name} → ${outFile}`);
  await download(chosen.browser_download_url, outFile);
  log.info('[xedit] downloaded');

  if (argv.extract) {
    const outDir = path.join(dest, 'xedit');

    log.info(`[extract] Starting extraction...`);
    await fullArchive(outFile, outDir);
    log.info(`[extract] Extracted to: ${outDir}`);
    log.info(`[xedit] ready → ${outDir}`);
  } else {
    log.info('[xedit] saved archive only (use --extract to unpack)');
  }
})().catch(err => {
  log.error(err);
  process.exit(1);
});
