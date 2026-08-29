/**
 * Placement of ESP text patches onto repeated subrecords.
 *
 * One record often carries several subrecords with the same signature: TERM menu
 * items (ITXT) and their result text (RNAM/UNAM), QUST objectives (NNAM) and log
 * entries (CNAM), multi-response INFO lines (NAM1). Stored record paths keep only
 * the signature, so a patch has to be bound to a specific occurrence — otherwise
 * every occurrence receives the same text and, for example, all terminal menu
 * items end up identical.
 *
 * Matching runs in two passes per signature:
 *   1. by the source text the patch was imported from (in order, so repeated
 *      identical source texts keep their relative order);
 *   2. positionally onto whatever slots are still free, for plugins whose text
 *      drifted since import.
 */
import type { EspPatch } from '../types';

/** One subrecord occurrence inside a record, in file order. */
export type SubrecordSlot = {
  /** Zero-based position in the record's subrecord walk. */
  position: number;
  /** Uppercase subrecord signature. */
  sig: string;
  /** Current payload, decoded the way EspReader decodes translatable text. */
  text: string;
};

export type RecordPatchPlan = {
  /** Slot position → replacement text. */
  byPosition: Map<number, string>;
  /** Patches with no matching subrecord left in the record. */
  unplaced: EspPatch[];
};

/** Group patches of one record by uppercase subrecord signature. */
export const groupPatchesBySig = (patches: EspPatch[]): Map<string, EspPatch[]> => {
  const bySig = new Map<string, EspPatch[]>();
  for (const patch of patches) {
    const sig = patch.subrecord.toUpperCase();
    const list = bySig.get(sig);
    if (list) list.push(patch);
    else bySig.set(sig, [patch]);
  }
  return bySig;
};

/**
 * Payloads EspReader never imports as strings, so they must stay untouched and
 * must not shift occurrence numbering: empty text and INNR's `*` placeholder.
 */
const isPatchableSlot = (slot: SubrecordSlot): boolean => slot.text !== '' && slot.text !== '*';

/**
 * Decide which subrecord occurrence each patch of a single record rewrites.
 *
 * @param slots - Subrecord occurrences of the record, in file order.
 * @param patchesBySig - Patches for this record grouped by subrecord signature.
 * @returns Replacement text per slot position plus any patches left over.
 */
export const buildRecordPatchPlan = (
  slots: SubrecordSlot[],
  patchesBySig: Map<string, EspPatch[]>,
): RecordPatchPlan => {
  const byPosition = new Map<number, string>();
  const unplaced: EspPatch[] = [];

  for (const [sig, patches] of patchesBySig) {
    // Candidates follow the same order and skips as the import walk, so index N
    // here is the record's Nth stored string for this signature.
    const candidates = slots.filter((slot) => slot.sig === sig && isPatchableSlot(slot));
    const ordered = [...patches].sort((a, b) => a.occurrence - b.occurrence);
    const isFree = (slot: SubrecordSlot): boolean => !byPosition.has(slot.position);
    const pending: EspPatch[] = [];

    for (const patch of ordered) {
      const slot = candidates.find((s) => isFree(s) && s.text === patch.oldText);
      if (slot) byPosition.set(slot.position, patch.newText);
      else pending.push(patch);
    }

    // Source text drifted since import — fall back to the recorded position.
    for (const patch of pending) {
      const preferred = candidates[patch.occurrence];
      const slot = preferred && isFree(preferred) ? preferred : candidates.find(isFree);
      if (slot) byPosition.set(slot.position, patch.newText);
      else unplaced.push(patch);
    }
  }

  return { byPosition, unplaced };
};
