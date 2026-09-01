/**
 * Mask Disco lockit markup before the LLM, same idea as ¤PH¤ / ¤FK¤.
 *
 * Wrappers stay as paired keys around translatable words:
 *   *belong*  → ¤IT0¤belong¤IT0¤
 *   "speech"  → ¤Q0¤speech¤Q0¤
 *   'Title'   → ¤TS0¤Title¤TS0¤
 * Opaque punctuation is a single key:
 *   --        → ¤EM0¤
 *
 * Unmask with {@link unmask}: each key maps back to `*` / `"` / `'` / `--`.
 */
import {
  DISCO_EM_DASH_RE,
  DISCO_ITALIC_RE,
  DISCO_QUOTE_PAIR_RES,
  DISCO_TITLE_SINGLE_RE,
} from './discoLockitMarkup';

const cloneRe = (re: RegExp): RegExp => new RegExp(re.source, re.flags);

const wrapWithKey = (
  mapping: Record<string, string>,
  prefix: string,
  index: number,
  inner: string,
  token: string,
): string => {
  const key = `¤${prefix}${index}¤`;
  mapping[key] = token;
  return `${key}${inner}${key}`;
};

/** Replace Disco `*…*`, `'…'`, quotes, and `--` with opaque ¤ keys. */
export const maskDiscoLockitMarkup = (
  text: string,
): { masked: string; mapping: Record<string, string> } => {
  const mapping: Record<string, string> = {};
  let italics = 0;
  let quotes = 0;
  let titleSingles = 0;
  let emDashes = 0;

  let out = text.replace(cloneRe(DISCO_ITALIC_RE), (_match, inner: string) =>
    wrapWithKey(mapping, 'IT', italics++, inner, '*'),
  );

  out = out.replace(cloneRe(DISCO_TITLE_SINGLE_RE), (_match, inner: string) =>
    wrapWithKey(mapping, 'TS', titleSingles++, inner, "'"),
  );

  for (const { re } of DISCO_QUOTE_PAIR_RES) {
    out = out.replace(cloneRe(re), (_match, inner: string) =>
      wrapWithKey(mapping, 'Q', quotes++, inner, '"'),
    );
  }

  out = out.replace(cloneRe(DISCO_EM_DASH_RE), () => {
    const key = `¤EM${emDashes++}¤`;
    mapping[key] = '--';
    return key;
  });

  return { masked: out, mapping };
};

/** No-op unless `game` is Disco. */
export const maskDiscoLockitMarkupIfDisco = (
  text: string,
  game?: string | null,
): { masked: string; mapping: Record<string, string> } => {
  if (game !== 'disco') return { masked: text, mapping: {} };
  return maskDiscoLockitMarkup(text);
};
