const interfaceTranslateFileName = (slot: string): string => `Translate_${slot}.txt`;

export const interfaceTranslateArchivePathForSlot = (slot: string): string =>
  `Interface\\${interfaceTranslateFileName(slot)}`;
