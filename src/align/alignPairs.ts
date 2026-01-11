import { CsvRow, AlignPair } from '../types.js';
import { fuzzyScore } from './fuzzy.js';
import { embedMany, cosine } from '../llm/embed.js';
import { getEmbedModel } from '../config.js';
import { log } from '../logger.js';

// Heuristic alignment with anchors → fuzzy → embeddings
export async function alignPairs(
  left: CsvRow[], right: CsvRow[],
  opts: { fuzzyMin?: number; fuzzyStrong?: number; useEmbeddings?: boolean; embedModel?: string }
): Promise<AlignPair[]> {
  const fuzzyMin = opts.fuzzyMin ?? 85;
  const fuzzyStrong = opts.fuzzyStrong ?? 90;
  const pairs: AlignPair[] = [];
  log.info(`Alignment: left=${left.length}, right=${right.length}, fuzzyMin=${fuzzyMin}, fuzzyStrong=${fuzzyStrong}, embeddings=${!!opts.useEmbeddings}`);

  // Indices by anchors
  const byHash = new Map<string, number[]>();
  const byEdidSig = new Map<string, number[]>();
  const bySigPath = new Map<string, number[]>();

  const keyEdidSig = (r: CsvRow) => `${r.Signature}::${r.EDID ?? ''}`;
  const keySigPath = (r: CsvRow) => `${r.Signature}::${r.Path.replace(/\[\d+\]/g, '')}`;

  right.forEach((r, i) => {
    if (r.Hash) byHash.set(r.Hash, [...(byHash.get(r.Hash) || []), i]);
    byEdidSig.set(keyEdidSig(r), [...(byEdidSig.get(keyEdidSig(r)) || []), i]);
    bySigPath.set(keySigPath(r), [...(bySigPath.get(keySigPath(r)) || []), i]);
  });

  const usedRight = new Set<number>();

  const addPair = (li: number, ri: number, method: AlignPair['method'], score: number) => {
    if (usedRight.has(ri)) return false;
    pairs.push({ leftIndex: li, rightIndex: ri, method, score });
    usedRight.add(ri);
    return true;
  };

  // Hard anchors
  for (let li = 0; li < left.length; li++) {
    const L = left[li];
    if (L.Hash && byHash.has(L.Hash)) {
      for (const ri of byHash.get(L.Hash)!) if (addPair(li, ri, 'hash', 1.0)) break;
      continue;
    }
    const cand1 = byEdidSig.get(keyEdidSig(L));
    if (cand1 && cand1.length === 1) { addPair(li, cand1[0], 'edid', 1.0); continue; }
    const cand2 = bySigPath.get(keySigPath(L));
    if (cand2 && cand2.length === 1) { addPair(li, cand2[0], 'path', 1.0); continue; }
  }

  // Fuzzy within same signature
  for (let li = 0; li < left.length; li++) {
    if (pairs.find(p => p.leftIndex === li)) continue;
    const L = left[li];
    const candidates: number[] = [];
    right.forEach((r, i) => { if (!usedRight.has(i) && r.Signature === L.Signature) candidates.push(i); });

    let bestRi = -1, best = 0;
    for (const ri of candidates) {
      const s = fuzzyScore(L.Source, right[ri].Source);
      if (s > best) { best = s; bestRi = ri; }
    }
    if (bestRi >= 0 && best >= fuzzyStrong) { addPair(li, bestRi, 'rapidfuzz', best / 100); }
  }

  // Embedding rerank for ambiguous cases
  if (opts.useEmbeddings) {
    for (let li = 0; li < left.length; li++) {
      if (pairs.find(p => p.leftIndex === li)) continue;
      const L = left[li];
      const candidates: number[] = [];
      right.forEach((r, i) => {
        if (!usedRight.has(i) && r.Signature === L.Signature) {
          const fs = fuzzyScore(L.Source, r.Source);
          if (fs >= fuzzyMin) candidates.push(i);
        }
      });
      if (candidates.length === 0) continue;
      const srcs = [L.Source];
      const tgts = candidates.map(i => right[i].Source);
      const embs = await embedMany([...srcs, ...tgts], opts.embedModel || getEmbedModel());
      const q = embs[0];
      const targetEmbs = embs.slice(1);
      let bestRi = -1, best = 0;
      for (let k = 0; k < targetEmbs.length; k++) {
        const sim = cosine(q, targetEmbs[k]);
        if (sim > best) { best = sim; bestRi = candidates[k]; }
      }
      if (bestRi >= 0) addPair(li, bestRi, 'embedding', best);
    }
  }

  log.info(`Alignment: ${pairs.length} pairs found (hash=${pairs.filter(p=>p.method==='hash').length} edid=${pairs.filter(p=>p.method==='edid').length} path=${pairs.filter(p=>p.method==='path').length} fuzzy=${pairs.filter(p=>p.method==='rapidfuzz').length} embed=${pairs.filter(p=>p.method==='embedding').length})`);
  return pairs;
}
