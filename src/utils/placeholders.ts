// Protects placeholders and tags so the model does not alter them.
// Mask format is ¤PH0¤ and ¤GL0¤ for easy post-replacement.

export const PLACEHOLDER_RE = new RegExp([
  String.raw`%\d*\$?[sdif]`,
  String.raw`\{[0-9]+\}`,
  String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
  String.raw`\[[^\]]+\]`,
  String.raw`<[^>]+>`,
  String.raw`\$[A-Za-z_][A-Za-z0-9_]*`
].join('|'), 'g');

export function maskPlaceholders(text: string) {
  const mapping: Record<string,string> = {};
  let i = 0;
  const masked = text.replace(PLACEHOLDER_RE, m => {
    const key = `¤PH${i}¤`;
    mapping[key] = m;
    i++;
    return key;
  });
  return { masked, mapping };
}

export function applyGlossaryMask(text: string, glossary: string[]) {
  const map: Record<string,string> = {};
  let out = text;
  glossary.forEach((term, i) => {
    if (!term) return;
    const key = `¤GL${i}¤`;
    if (out.includes(term)) {
      out = out.split(term).join(key);
      map[key] = term;
    }
  });
  return { masked: out, mapping: map };
}

export function unmask(text: string, mapping: Record<string,string>) {
  let out = text;
  // Sort keys by length (longest first) to prevent partial matches
  const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const k of keys) out = out.split(k).join(mapping[k]);
  return out;
}
