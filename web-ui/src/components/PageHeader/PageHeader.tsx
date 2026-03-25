import type { ReactNode } from 'react';
import s from './PageHeader.module.scss';

interface PageHeaderProps {
  /** Primary page title. */
  title: string;
  /** Optional short description displayed below the title. */
  description?: string;
  /** Optional CTA buttons or controls aligned to the right of the title. */
  actions?: ReactNode;
  /**
   * Optional secondary context strip rendered below the title row.
   * Use for item counts, status summaries, or last-sync timestamps.
   */
  meta?: ReactNode;
  /**
   * Heading level for the title element.
   * Use `2` when the page header appears inside a larger shell that already
   * has an `<h1>` (e.g. Settings tabs embedding sub-pages).
   * Defaults to `1`.
   */
  level?: 1 | 2;
}

/**
 * PageHeader — shared page-level header shell.
 *
 * Renders a consistent title + optional description + optional right-aligned
 * action slot. Accepts an optional `meta` strip for secondary context such
 * as item counts or status summaries.
 *
 * Usage:
 * ```tsx
 * <PageHeader
 *   title={t('glossary.title')}
 *   description={t('glossary.description')}
 *   actions={<button className={s.btnAdd}>{t('glossary.addPair')}</button>}
 * />
 * ```
 */
export const PageHeader = ({
  title,
  description,
  actions,
  meta,
  level = 1,
}: PageHeaderProps) => {
  const Heading = level === 2 ? 'h2' : 'h1';
  return (
    <div className={s.header}>
      <div className={s.row}>
        <div className={s.titleBlock}>
          <Heading className={s.title}>{title}</Heading>
          {description && <p className={s.description}>{description}</p>}
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {meta && <div className={s.meta}>{meta}</div>}
    </div>
  );
};
