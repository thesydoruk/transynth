/** FO4/SSE FaceFX expects dialogue text as UTF-8 bytes in ANSI argv. */
export const encodeFaceFxDialogueText = (text: string): string => {
  if (process.platform !== 'win32') return text;
  return Buffer.from(text, 'utf8').toString('latin1');
};
