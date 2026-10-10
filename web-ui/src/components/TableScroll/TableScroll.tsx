import type { CSSProperties, ReactNode } from 'react';
import s from './TableScroll.module.scss';

type TableScrollProps = {
  children: ReactNode;
  /**
   * Narrowest the table may get, in px. A full-width table on a phone squeezes
   * every column until words break letter by letter; past this width it
   * scrolls sideways instead. Leave unset for a table that reads fine narrow.
   */
  minWidth?: number;
  /**
   * Pins the last column to the right edge while the rest scrolls, so the
   * row's buttons never leave the screen on a phone or tablet.
   */
  stickyActions?: boolean;
  /**
   * On a phone, each row becomes a card with its cells stacked, instead of a
   * table scrolled sideways. A cell with `data-label` shows that label first.
   */
  cards?: boolean;
};

/**
 * Lets a wide table scroll sideways inside its own box.
 *
 * Without it a table with many columns pushes the whole page wider than a
 * phone or tablet screen, and the top bar scrolls away with it.
 */
export const TableScroll = ({ children, minWidth, stickyActions, cards }: TableScrollProps) => (
  <div
    className={`${s.scroll}${stickyActions ? ` ${s.stickyActions}` : ''}${cards ? ` ${s.cards}` : ''}`}
    style={minWidth ? ({ '--table-min-width': `${minWidth}px` } as CSSProperties) : undefined}
  >
    {children}
  </div>
);
