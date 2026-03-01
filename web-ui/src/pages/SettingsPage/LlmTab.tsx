import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import s from './SettingsPage.module.scss';

/** Read-only LLM configuration tab sourced from server settings. */
export const LlmTab = () => {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    staleTime: 60_000,
  });

  if (isLoading) return <div className={s.center}>{t('common.loading')}</div>;
  if (error || !data) {
    return <div className={`${s.center} ${s.error}`}>{t('common.error', { message: String(error) })}</div>;
  }

  return (
    <>
      <div className={s.readonlyNote}>ℹ️ {t('settings.llm.readonlyNote')}</div>
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.providerSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.provider')}</span>
          <span className={s.fieldValue}>{data.llmProvider} <span className={`${s.badge} ${s.badgeOk}`}>{t('common.active')}</span></span>
          <span className={s.fieldLabel}>{t('settings.llm.fallback')}</span>
          <span className={s.fieldValue}>{data.llmFallback}</span>
          <span className={s.fieldLabel}>{t('settings.llm.batchSize')}</span>
          <span className={s.fieldValue}>{data.batchSize}</span>
        </div>
      </div>
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.ollamaSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.ollamaUrl')}</span>
          <span className={s.fieldValue}>{data.ollamaBaseUrl}</span>
          <span className={s.fieldLabel}>{t('settings.llm.ollamaModel')}</span>
          <span className={s.fieldValue}>{data.ollamaModel || '—'}</span>
        </div>
      </div>
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.openaiSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.openaiKey')}</span>
          <span className={s.fieldValue}>
            <span className={`${s.badge} ${data.openaiKeyConfigured ? s.badgeOk : s.badgeWarn}`}>
              {data.openaiKeyConfigured ? t('settings.llm.keySet') : t('settings.llm.keyNotSet')}
            </span>
          </span>
          <span className={s.fieldLabel}>{t('settings.llm.translateModel')}</span>
          <span className={s.fieldValue}>{data.translateModel || '—'}</span>
          <span className={s.fieldLabel}>{t('settings.llm.embedModel')}</span>
          <span className={s.fieldValue}>{data.embedModel || '—'}</span>
        </div>
      </div>
      <div className={s.section}>
        <h2 className={s.sectionTitle}>{t('settings.llm.systemSection')}</h2>
        <div className={s.fieldGrid}>
          <span className={s.fieldLabel}>{t('settings.llm.multiUser')}</span>
          <span className={s.fieldValue}>
            <span className={`${s.badge} ${data.multiUser ? s.badgeOk : s.badgeWarn}`}>
              {data.multiUser ? t('common.enabled') : t('common.disabled')}
            </span>
          </span>
          <span className={s.fieldLabel}>{t('settings.llm.sessionLifetime')}</span>
          <span className={s.fieldValue}>{data.sessionLifetimeHours}h</span>
        </div>
      </div>
    </>
  );
};