import { pushAllCapped, pushCapped, trimCappedArray } from '../cappedArray';

describe('cappedArray', () => {
  it('defers trim until twice the limit, then keeps the newest items', () => {
    const rows: number[] = [];
    for (let i = 1; i <= 8; i++) pushCapped(rows, i, 4);
    expect(rows).toEqual([5, 6, 7, 8]);
  });

  it('pushAllCapped trims the same way', () => {
    const rows = [1, 2];
    pushAllCapped(rows, [3, 4, 5, 6, 7, 8], 4);
    expect(rows).toEqual([5, 6, 7, 8]);
  });

  it('trimCappedArray cuts to the exact limit', () => {
    const rows = [1, 2, 3, 4, 5];
    trimCappedArray(rows, 3);
    expect(rows).toEqual([3, 4, 5]);
  });
});
