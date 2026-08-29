/** Bracketed tone tag / UI token: `[Сарказм]`, `[Click]`, … */
const BRACKET_BLOCK_RE = /\[[^[\]]*\]/g;

/**
 * Drop bracketed blocks before phoneme analysis.
 *
 * FaceFXWrapper never returns when a `[...]` block holds non-ASCII text (a
 * translated tone tag such as `[Сарказм]`), so the run only ends on our
 * timeout. The tags are not spoken anyway, so they carry no phonemes.
 */
export const sanitizeFaceFxDialogueText = (text: string): string =>
  text.replace(BRACKET_BLOCK_RE, ' ').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();

/** FO4/SSE FaceFX expects dialogue text as UTF-8 bytes in ANSI argv. */
export const encodeFaceFxDialogueText = (text: string): string => {
  if (process.platform !== 'win32') return text;
  return Buffer.from(text, 'utf8').toString('latin1');
};
