import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type StringRow } from '../../../../api';
import { useEditorSelection } from '../useEditorSelection';

const rowOf = (string_id: number) => ({ string_id }) as StringRow;
const click = { stopPropagation: () => {} } as MouseEvent;

const NO_COLUMN_FILTERS = { grup: '', formid: '', edid: '', field: '', src: '', transl: '' };

const render = (total = 5, overrides: Partial<Parameters<typeof useEditorSelection>[0]> = {}) =>
  renderHook(() =>
    useEditorSelection({
      modId: 7,
      srcLang: 'en',
      targetLang: 'uk',
      selectedStatuses: [],
      qaOnly: false,
      signature: '',
      columnFilters: NO_COLUMN_FILTERS,
      rows: [1, 2, 3].map(rowOf),
      total,
      ...overrides,
    }),
  );

describe('useEditorSelection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects and unselects single rows', async () => {
    const hook = render();

    act(() => hook.result.current.toggleRow(rowOf(2), click));
    act(() => hook.result.current.toggleRow(rowOf(3), click));
    act(() => hook.result.current.toggleRow(rowOf(3), click));

    expect(hook.result.current.selectedCount).toBe(1);
    expect(hook.result.current.isRowSelected(2)).toBe(true);
    expect(hook.result.current.someSelected).toBe(true);
    expect(await hook.result.current.resolveSelectedIds()).toEqual([2]);
  });

  it('selects every matching row, loaded or not, without fetching them', () => {
    const matchingIds = vi.spyOn(api.strings, 'matchingIds');
    const hook = render(500);

    act(() => hook.result.current.toggleAll());

    expect(hook.result.current.allSelected).toBe(true);
    expect(hook.result.current.selectedCount).toBe(500);
    expect(hook.result.current.isRowSelected(999)).toBe(true);
    expect(matchingIds).not.toHaveBeenCalled();
  });

  it('treats a click after "select all" as an exception, not a selection', () => {
    const hook = render(500);

    act(() => hook.result.current.toggleAll());
    act(() => hook.result.current.toggleRow(rowOf(2), click));

    expect(hook.result.current.isRowSelected(2)).toBe(false);
    expect(hook.result.current.selectedCount).toBe(499);
    expect(hook.result.current.allSelected).toBe(false);
    expect(hook.result.current.someSelected).toBe(true);
    expect(hook.result.current.selectedLoadedRows().map((r) => r.string_id)).toEqual([1, 3]);
  });

  it('asks the server for the matching ids under the current filter, minus the exceptions', async () => {
    const matchingIds = vi
      .spyOn(api.strings, 'matchingIds')
      .mockResolvedValue({ ids: [1, 2, 3, 40, 41] });
    const hook = render(5, {
      selectedStatuses: ['draft', 'tm'],
      qaOnly: true,
      signature: 'NPC_',
      columnFilters: { ...NO_COLUMN_FILTERS, edid: 'SS2_' },
    });

    act(() => hook.result.current.toggleAll());
    act(() => hook.result.current.toggleRow(rowOf(2), click));
    const ids = await hook.result.current.resolveSelectedIds();

    expect(ids).toEqual([1, 3, 40, 41]);
    expect(matchingIds).toHaveBeenCalledWith({
      modId: 7,
      srcLang: 'en',
      targetLang: 'uk',
      status: 'draft,tm',
      qaOnly: true,
      signature: 'NPC_',
      grup: undefined,
      formid: undefined,
      edid: 'SS2_',
      field: undefined,
      src: undefined,
      transl: undefined,
    });
  });

  it('turns "select all" off on a second press', () => {
    const hook = render(500);

    act(() => hook.result.current.toggleAll());
    act(() => hook.result.current.toggleAll());

    expect(hook.result.current.hasSelection).toBe(false);
    expect(hook.result.current.selectAllMatching).toBe(false);
  });

  it('re-selects everything when "select all" is pressed with exceptions', () => {
    const hook = render(500);

    act(() => hook.result.current.toggleAll());
    act(() => hook.result.current.toggleRow(rowOf(2), click));
    act(() => hook.result.current.toggleAll());

    expect(hook.result.current.allSelected).toBe(true);
    expect(hook.result.current.selectedCount).toBe(500);
  });

  it('never claims "all selected" over an empty result', () => {
    const hook = render(0);

    act(() => hook.result.current.toggleAll());

    expect(hook.result.current.allSelected).toBe(false);
    expect(hook.result.current.selectedCount).toBe(0);
    expect(hook.result.current.hasSelection).toBe(false);
  });
});
