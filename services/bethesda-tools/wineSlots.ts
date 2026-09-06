import fs from 'node:fs';
import path from 'node:path';

export type WineSlot = {
  id: number;
  prefix: string;
  active: number;
  assigned: number;
};

const clampInt = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const parseWineServerCount = (raw: string | undefined): number => clampInt(raw, 1, 1, 16);

/** FaceFX jobs allowed on one wineserver. Default 1 — more just waits on the same server. */
export const parsePerWine = (raw: string | undefined): number => clampInt(raw, 1, 1, 4);

export const wineSlotPrefix = (root: string, id: number): string => path.join(root, `w${id}`);

/** Move a leftover flat WINEPREFIX into `w0` so sibling prefixes can live beside it. */
export const migrateLegacyWinePrefix = (root: string): void => {
  const legacyReg = path.join(root, 'system.reg');
  const first = wineSlotPrefix(root, 0);
  if (!fs.existsSync(legacyReg) || fs.existsSync(path.join(first, 'system.reg'))) return;
  fs.mkdirSync(first, { recursive: true });
  for (const name of fs.readdirSync(root)) {
    if (/^w\d+$/.test(name)) continue;
    fs.renameSync(path.join(root, name), path.join(first, name));
  }
};

/** Prefer the least busy slot; break ties by fewest assignments, then lowest id. */
export const pickWineSlot = (slots: readonly WineSlot[], perWine: number): WineSlot | null => {
  let best: WineSlot | null = null;
  for (const slot of slots) {
    if (slot.active >= perWine) continue;
    if (
      !best ||
      slot.active < best.active ||
      (slot.active === best.active && slot.assigned < best.assigned) ||
      (slot.active === best.active && slot.assigned === best.assigned && slot.id < best.id)
    ) {
      best = slot;
    }
  }
  return best;
};

export const createWineSlotPool = (root: string, count: number, perWine: number) => {
  const slots: WineSlot[] = Array.from({ length: count }, (_, id) => ({
    id,
    prefix: wineSlotPrefix(root, id),
    active: 0,
    assigned: 0,
  }));
  const waiters: Array<() => void> = [];

  const snapshot = (): WineSlot[] => slots.map((slot) => ({ ...slot }));

  const acquire = async (): Promise<WineSlot> => {
    for (;;) {
      const slot = pickWineSlot(slots, perWine);
      if (slot) {
        slot.active += 1;
        slot.assigned += 1;
        return slot;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  const release = (slot: WineSlot): void => {
    slot.active = Math.max(0, slot.active - 1);
    const next = waiters.shift();
    if (next) next();
  };

  const activeCount = (): number => slots.reduce((sum, slot) => sum + slot.active, 0);

  return { slots, acquire, release, snapshot, activeCount };
};
