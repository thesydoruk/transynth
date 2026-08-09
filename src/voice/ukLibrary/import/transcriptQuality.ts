/** True when text is usable as a Fish Speech reference transcript. */
export const isUsableTranscript = (text: string | null | undefined): boolean => {
  const trimmed = (text ?? '').trim();
  if (trimmed.length < 8) return false;
  // Placeholder / punctuation-only rows seen in older HF mirrors.
  if (/^[-—–._·•…]+$/u.test(trimmed)) return false;
  // Prefer real letters (Latin or Cyrillic), not digits/punct alone.
  if (!/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(trimmed)) return false;
  return true;
};
