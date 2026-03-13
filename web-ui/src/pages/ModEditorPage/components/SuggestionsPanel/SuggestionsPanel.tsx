import { useTranslation } from 'react-i18next';
import type { TMSuggestion } from '../../../../api';
import { StatusBadge } from '../../../../components/StatusBadge';
import parentS from '../../ModEditorPage.module.scss';
import s from './SuggestionsPanel.module.scss';

interface SuggestionsPanelProps {
  suggestions: TMSuggestion[];
  onApply: (text: string) => void;
}

/** Translation-memory suggestions panel for the active row. */
export const SuggestionsPanel = ({ suggestions, onApply }: SuggestionsPanelProps) => {
  const { t } = useTranslation();

  if (suggestions.length === 0) {
    return <div className={parentS.panelEmpty}>{t('modEditor.noSuggestions')}</div>;
  }

  const methodLabel = (method: string) => method === 'exact'
    ? t('modEditor.exact')
    : method === 'numeric'
      ? t('modEditor.numeric')
      : method === 'punct_norm'
        ? t('modEditor.punct')
        : method === 'segment'
          ? t('modEditor.phrase')
          : t('modEditor.fuzzyMethod');

  const methodColor = (method: string) => method === 'exact'
    ? '#4caf50'
    : method === 'numeric'
      ? '#66bb6a'
      : method === 'punct_norm'
        ? '#ff9800'
        : method === 'segment'
          ? '#ab47bc'
          : '#2196f3';

  return (
    <div className={parentS.panelListGap4}>
      {suggestions.map((suggestion) => (
        <div key={suggestion.id} className={s.suggestionRow}>
          <StatusBadge status={suggestion.status} small />
          <span className={s.suggMethod} style={{ '--sugg-color': methodColor(suggestion.match_method) } as React.CSSProperties}>
            {methodLabel(suggestion.match_method)}
          </span>
          <span className={s.suggText}>{suggestion.text}</span>
          <span className={s.suggSim}>{Math.round(suggestion.similarity * 100)}%</span>
          <button onClick={() => onApply(suggestion.text)} className={s.suggestionApplyBtn}>
            {t('common.apply')}
          </button>
        </div>
      ))}
    </div>
  );
};
