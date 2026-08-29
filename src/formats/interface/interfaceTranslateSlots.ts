import type { GameType } from '../../types';
import { exportLocaleSlots } from '../../locale/exportSlots';

/** @deprecated Use {@link exportLocaleSlots} — kept for single-slot call sites during migration. */
export const interfaceTranslateExportSlot = (targetLang: string, game: GameType): string =>
  exportLocaleSlots(targetLang, game)[0] ?? targetLang.trim().toLowerCase();

export const interfaceTranslateExportSlots = exportLocaleSlots;

export const interfaceTranslateFileName = (slot: string): string => `Translate_${slot}.txt`;

export const interfaceTranslateArchivePathForSlot = (slot: string): string =>
  `Interface\\${interfaceTranslateFileName(slot)}`;
