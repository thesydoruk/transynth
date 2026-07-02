import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { StringRow, PexSourceSnippet } from '../../../../api';
import { api } from '../../../../api';
import { parsePexStoredContext } from '../../../../utils/pexStoredContext';
import styles from './DetailPanel.module.scss';

export interface PexSourcePanelProps {
  modId: number;
  activeRow: StringRow;
}

const PexSourceCodeBlock = ({ snippet }: { snippet: PexSourceSnippet }) => {
  const { t } = useTranslation();
  const primaryLine = snippet.matchLineNumbers[0];

  return (
    <div className={styles.pexSourcePanel}>
      <div className={styles.pexSourceHeader}>
        <span className={styles.pexSourceTitle}>{t('modEditor.pexSourceTitle')}</span>
        <span className={styles.pexSourceMeta}>
          {snippet.scriptLabel}
          {primaryLine != null ? ` · line ${primaryLine}` : ''}
        </span>
      </div>
      <pre className={styles.pexSourceCode}>
        {snippet.contextLines.map((line) => (
          <div
            key={line.lineNumber}
            className={line.highlight ? styles.pexSourceLineHighlight : styles.pexSourceLine}
          >
            <span className={styles.pexSourceLineNo}>{line.lineNumber}</span>
            <span className={styles.pexSourceLineText}>{line.text || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
};

/**
 * Show decompiled Papyrus source around the active PEX literal.
 * Uses context stored at import time; falls back to on-demand decompile for legacy rows.
 */
export const PexSourcePanel = ({ modId, activeRow }: PexSourcePanelProps) => {
  const { t } = useTranslation();
  const storedSnippet = useMemo(
    () => parsePexStoredContext(activeRow.context),
    [activeRow.context],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pex-source', modId, activeRow.string_id],
    queryFn: () => api.mods.pexSource(modId, activeRow.string_id),
    enabled: activeRow.signature === 'PEX' && storedSnippet == null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  if (activeRow.signature !== 'PEX') return null;

  if (storedSnippet) {
    return <PexSourceCodeBlock snippet={storedSnippet} />;
  }

  if (isLoading) {
    return <div className={styles.pexSourcePanel}>{t('modEditor.pexSourceLoading')}</div>;
  }

  if (!data || !data.ok) {
    const message =
      data && !data.ok
        ? data.message
        : isError
          ? t('modEditor.pexSourceError')
          : t('modEditor.pexSourceUnavailable');
    return (
      <div className={styles.pexSourcePanel} title={message}>
        <div className={styles.pexSourceHint}>{t('modEditor.pexSourceUnavailable')}</div>
        <div className={styles.pexSourceHintDetail}>{message}</div>
      </div>
    );
  }

  return <PexSourceCodeBlock snippet={data.snippet} />;
};
