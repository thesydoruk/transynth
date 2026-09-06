import { describe, expect, it } from '@jest/globals';
import { pickWineSlot, type WineSlot } from '../../../../services/bethesda-tools/wineSlots';

const slot = (id: number, active: number, assigned: number): WineSlot => ({
  id,
  prefix: `w${id}`,
  active,
  assigned,
});

describe('pickWineSlot', () => {
  it('spreads first jobs across empty servers', () => {
    const slots = [slot(0, 0, 0), slot(1, 0, 0), slot(2, 0, 0)];
    const first = pickWineSlot(slots, 1);
    expect(first?.id).toBe(0);
    first!.active += 1;
    first!.assigned += 1;
    expect(pickWineSlot(slots, 1)?.id).toBe(1);
  });

  it('prefers the least busy server', () => {
    const slots = [slot(0, 1, 10), slot(1, 0, 3), slot(2, 1, 2)];
    expect(pickWineSlot(slots, 1)?.id).toBe(1);
  });

  it('breaks equal load by assignment count', () => {
    const slots = [slot(0, 0, 8), slot(1, 0, 3), slot(2, 0, 5)];
    expect(pickWineSlot(slots, 1)?.id).toBe(1);
  });

  it('returns null when every server is full', () => {
    expect(pickWineSlot([slot(0, 1, 4), slot(1, 1, 4)], 1)).toBeNull();
  });
});
