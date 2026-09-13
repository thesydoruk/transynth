import type { GameType } from '../types';

const FO4_MASTERS = [
  'Fallout4.esm',
  'DLCRobot.esm',
  'DLCworkshop01.esm',
  'DLCCoast.esm',
  'DLCworkshop02.esm',
  'DLCworkshop03.esm',
  'DLCNukaWorld.esm',
] as const;

const FO76_MASTERS = ['SeventySix.esm'] as const;

const FO3_MASTERS = [
  'Fallout3.esm',
  'Anchorage.esm',
  'ThePitt.esm',
  'BrokenSteel.esm',
  'PointLookout.esm',
  'Zeta.esm',
] as const;

const FNV_MASTERS = [
  'FalloutNV.esm',
  'DeadMoney.esm',
  'HonestHearts.esm',
  'OldWorldBlues.esm',
  'LonesomeRoad.esm',
  'GunRunnersArsenal.esm',
] as const;

const SSE_MASTERS = [
  'Skyrim.esm',
  'Update.esm',
  'Dawnguard.esm',
  'HearthFires.esm',
  'Dragonborn.esm',
] as const;

const SLE_MASTERS = SSE_MASTERS;

const MASTER_LIST: Partial<Record<GameType, readonly string[]>> = {
  fo4: FO4_MASTERS,
  fo76: FO76_MASTERS,
  fo3: FO3_MASTERS,
  fnv: FNV_MASTERS,
  sse: SSE_MASTERS,
  sle: SLE_MASTERS,
};

export const officialMasterNames = (game: GameType): readonly string[] => MASTER_LIST[game] ?? [];

export const isCreationClubPlugin = (fileName: string): boolean =>
  fileName.toLowerCase().startsWith('cc') &&
  (fileName.toLowerCase().endsWith('.esm') ||
    fileName.toLowerCase().endsWith('.esl') ||
    fileName.toLowerCase().endsWith('.esp'));

export const isOfficialGamePlugin = (game: GameType, fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  if (officialMasterNames(game).some((name) => name.toLowerCase() === lower)) return true;
  return isCreationClubPlugin(fileName);
};
