import { useMemo, useState } from 'react';
import type { CoherenceEntry, CoherenceGroup } from '../../api';
import { VariantCard } from './VariantCard';
import s from './CoherencePage.module.scss';

interface GroupCardProps {
  group: CoherenceGroup;
  onResolve: (textNorm: string, translation: string) => void;
  isResolving: boolean;
}

/**
 * Groups a flat coherence entry list by translation text so the UI can render
 * one expandable card per distinct translation variant.
 */
const groupByVariant = (entries: CoherenceEntry[]) => {
  const grouped = new Map<string, CoherenceEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.translation);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(entry.translation, [entry]);
    }
  }

  return Array.from(grouped.entries())
    .sort((left, right) => right[1].length - left[1].length)
    .map(([translation, strings]) => ({ translation, strings }));
};

/**
 * Displays one coherence conflict group and reveals all candidate translations
 * when the user expands the row.
 */
export const GroupCard = ({ group, onResolve, isResolving }: GroupCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const variants = useMemo(() => groupByVariant(group.entries), [group.entries]);

  return (
    <div className={s.group}>
      <div className={s.groupHeader} onClick={() => setExpanded((value) => !value)}>
        <span className={s.groupToggle}>{expanded ? '▼' : '▶'}</span>
        <span className={s.groupSource} title={group.source_text}>{group.source_text}</span>
        <span className={s.groupBadge}>{group.variant_count}</span>
      </div>
      {expanded && (
        <div className={s.variants}>
          {variants.map((variant) => (
            <VariantCard
              key={variant.translation}
              translation={variant.translation}
              strings={variant.strings}
              onApply={(translation) => onResolve(group.text_norm, translation)}
              isApplying={isResolving}
            />
          ))}
        </div>
      )}
    </div>
  );
};