import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { StringRow, PexSourceSnippet } from '../../../../api';
import { api } from '../../../../api';
import { parsePexStoredContext } from '../../../../utils/pexStoredContext';
import { splitPexLineForLiteralHighlight } from './utils/pexLineLiteralHighlight';
import styles from './PexSourcePanel.module.scss';

export interface PexSourcePanelProps {
  modId: number;
  activeRow: StringRow;
}

const PexSourceCodeBlock = ({
  snippet,
  literal,
  fill = false,
}: {
  snippet: PexSourceSnippet;
  literal: string;
  fill?: boolean;
}) => (
  <div className={`${styles.pexSourcePanel} ${fill ? styles.pexSourcePanelFill : ''}`}>
    <pre className={`${styles.pexSourceCode} ${fill ? styles.pexSourceCodeFill : ''}`}>
      {snippet.contextLines.map((line) => (
        <div
          key={line.lineNumber}
          className={line.highlight ? styles.pexSourceLineHighlight : styles.pexSourceLine}
        >
          <span className={styles.pexSourceLineNo}>{line.lineNumber}</span>
          <span className={styles.pexSourceLineText}>
            {splitPexLineForLiteralHighlight(line.text, literal, line.highlight).map(
              (part, index) =>
                part.highlight ? (
                  <mark key={index} className={styles.pexSourceLiteral}>
                    {part.text}
                  </mark>
                ) : (
                  <span key={index}>{part.text}</span>
                ),
            )}
          </span>
        </div>
      ))}
    </pre>
  </div>
);

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
    return <PexSourceCodeBlock snippet={storedSnippet} literal={activeRow.source} fill />;
  }

  if (isLoading) {
    return (
      <div className={`${styles.pexSourcePanel} ${styles.pexSourcePanelFill}`}>
        {t('modEditor.pexSourceLoading')}
      </div>
    );
  }

  if (!data || !data.ok) {
    const message =
      data && !data.ok
        ? data.message
        : isError
          ? t('modEditor.pexSourceError')
          : t('modEditor.pexSourceUnavailable');
    return (
      <div className={`${styles.pexSourcePanel} ${styles.pexSourcePanelFill}`} title={message}>
        <div className={styles.pexSourceHint}>{t('modEditor.pexSourceUnavailable')}</div>
        <div className={styles.pexSourceHintDetail}>{message}</div>
      </div>
    );
  }

  return <PexSourceCodeBlock snippet={data.snippet} literal={activeRow.source} fill />;
};
