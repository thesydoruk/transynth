import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorFilterState } from '../useEditorFilterState';

/** The hook plus what the router shows, so URL effects can be asserted. */
const useProbe = (modId: number, clearSelection: () => void) => ({
  filter: useEditorFilterState({ modId, clearSelection }),
  location: useLocation(),
  navigate: useNavigate(),
});

const render = (url: string, modId = 7, history: string[] = []) => {
  const clearSelection = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[...history, url]}>{children}</MemoryRouter>
  );
  const hook = renderHook(() => useProbe(modId, clearSelection), { wrapper });
  return { hook, clearSelection };
};

const search = (hook: { result: { current: { location: { search: string } } } }) =>
  new URLSearchParams(hook.result.current.location.search);

describe('useEditorFilterState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('where the filters start', () => {
    it('takes statuses and the QA flag from the address', () => {
      const { hook } = render('/games/fo4/mods/7?status=draft,rejected&qaOnly=1');

      expect(hook.result.current.filter.selectedStatuses).toEqual(['draft', 'rejected']);
      expect(hook.result.current.filter.qaOnly).toBe(true);
    });

    it('drops status tokens it does not know, and duplicates', () => {
      const { hook } = render('/games/fo4/mods/7?status=draft,banana,draft');

      expect(hook.result.current.filter.selectedStatuses).toEqual(['draft']);
    });

    it('falls back to what was last used on this mod when the address says nothing', () => {
      localStorage.setItem(
        'editor-intent-7',
        JSON.stringify({ statuses: ['reviewed'], qaOnly: true, signature: 'INFO' }),
      );

      const { hook } = render('/games/fo4/mods/7');

      expect(hook.result.current.filter).toMatchObject({
        selectedStatuses: ['reviewed'],
        qaOnly: true,
        signature: 'INFO',
      });
    });

    it('lets the address win over what was stored', () => {
      localStorage.setItem('editor-intent-7', JSON.stringify({ statuses: ['reviewed'] }));

      const { hook } = render('/games/fo4/mods/7?status=draft&qaOnly=0');

      expect(hook.result.current.filter.selectedStatuses).toEqual(['draft']);
      expect(hook.result.current.filter.qaOnly).toBe(false);
    });

    it('reads the single-status form older versions stored', () => {
      localStorage.setItem('editor-intent-7', JSON.stringify({ status: 'fuzzy' }));

      expect(render('/games/fo4/mods/7').hook.result.current.filter.selectedStatuses).toEqual([
        'fuzzy',
      ]);
    });

    it('survives a corrupt stored value', () => {
      localStorage.setItem('editor-intent-7', '{not json');

      expect(render('/games/fo4/mods/7').hook.result.current.filter.selectedStatuses).toEqual([]);
    });

    it('keeps each mod’s filters apart', () => {
      localStorage.setItem('editor-intent-8', JSON.stringify({ statuses: ['reviewed'] }));

      expect(render('/games/fo4/mods/7').hook.result.current.filter.selectedStatuses).toEqual([]);
    });
  });

  describe('keeping the address in step', () => {
    it('writes a new selection into the address without adding a history entry', () => {
      const { hook } = render('/games/fo4/mods/7', 7, ['/games/fo4']);

      act(() => hook.result.current.filter.setSelectedStatuses(['draft', 'tm']));
      act(() => hook.result.current.filter.setQaOnly(true));

      expect(search(hook).get('status')).toBe('draft,tm');
      expect(search(hook).get('qaOnly')).toBe('1');
      // replace, not push: one step back leaves the editor instead of undoing a filter
      act(() => hook.result.current.navigate(-1));
      expect(hook.result.current.location.pathname).toBe('/games/fo4');
    });

    it('removes the parameters when the filter is cleared', () => {
      const { hook } = render('/games/fo4/mods/7?status=draft&qaOnly=1');

      act(() => hook.result.current.filter.setSelectedStatuses([]));
      act(() => hook.result.current.filter.setQaOnly(false));

      expect(search(hook).has('status')).toBe(false);
      expect(search(hook).has('qaOnly')).toBe(false);
    });

    it('remembers the filters for the next visit to this mod', () => {
      const { hook } = render('/games/fo4/mods/7');

      act(() => hook.result.current.filter.setSelectedStatuses(['rejected']));
      act(() => hook.result.current.filter.setSignature('NPC_'));

      expect(JSON.parse(localStorage.getItem('editor-intent-7')!)).toEqual({
        statuses: ['rejected'],
        qaOnly: false,
        signature: 'NPC_',
      });
    });

    it('keeps the editor mode in the address, and the back button returns to the grid', () => {
      const { hook } = render('/games/fo4/mods/7');

      act(() => hook.result.current.filter.setPageMode('dialogs'));
      expect(hook.result.current.filter.pageMode).toBe('dialogs');
      expect(search(hook).get('mode')).toBe('dialogs');

      act(() => hook.result.current.navigate(-1));
      expect(hook.result.current.filter.pageMode).toBe('strings');
    });

    it('treats an unknown mode in the address as the grid', () => {
      expect(render('/games/fo4/mods/7?mode=banana').hook.result.current.filter.pageMode).toBe(
        'strings',
      );
    });
  });

  describe('sorting and column filters', () => {
    it('cycles a column through ascending, descending and off, clearing the selection', () => {
      const { hook, clearSelection } = render('/games/fo4/mods/7');
      const sort = () => act(() => hook.result.current.filter.handleSort('src'));
      const state = () => [hook.result.current.filter.sortCol, hook.result.current.filter.sortDir];

      sort();
      expect(state()).toEqual(['src', 'asc']);
      sort();
      expect(state()).toEqual(['src', 'desc']);
      sort();
      expect(state()).toEqual([null, 'asc']);
      expect(clearSelection).toHaveBeenCalledTimes(3);
    });

    it('starts a different column ascending', () => {
      const { hook } = render('/games/fo4/mods/7');

      act(() => hook.result.current.filter.handleSort('src'));
      act(() => hook.result.current.filter.handleSort('src'));
      act(() => hook.result.current.filter.handleSort('transl'));

      expect(hook.result.current.filter.sortCol).toBe('transl');
      expect(hook.result.current.filter.sortDir).toBe('asc');
    });

    it('changes one column filter and clears the selection', () => {
      const { hook, clearSelection } = render('/games/fo4/mods/7');

      act(() => hook.result.current.filter.handleColumnFilterChange('edid', 'SS2_'));

      expect(hook.result.current.filter.columnFilters).toMatchObject({ edid: 'SS2_', src: '' });
      expect(clearSelection).toHaveBeenCalledTimes(1);
    });
  });
});
