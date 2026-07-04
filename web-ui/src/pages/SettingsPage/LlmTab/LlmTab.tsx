import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import parentS from '../SettingsPage.module.scss';
import s from './LlmTab.module.scss';

const ISSUE_KEY_BY_CODE: Record<string, string> = {
  primary_openai_key_missing: 'settings.llm.issues.primaryOpenAiKeyMissing',
  primary_vllm_model_missing: 'settings.llm.issues.primaryVllmModelMissing',
  fallback_openai_key_missing: 'settings.llm.issues.fallbackOpenAiKeyMissing',
  fallback_vllm_model_missing: 'settings.llm.issues.fallbackVllmModelMissing',
  fallback_same_as_primary: 'settings.llm.issues.fallbackSameAsPrimary',
  translate_model_missing_openai: 'settings.llm.issues.translateModelMissingOpenAi',
  translate_model_missing_vllm: 'settings.llm.issues.translateModelMissingVllm',
  embed_model_missing_openai: 'settings.llm.issues.embedModelMissingOpenAi',
  embed_model_missing_vllm: 'settings.llm.issues.embedModelMissingVllm',
};

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
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', { message: String(error) })}
      </div>
    );
  }

  const readinessBadgeClass =
    data.llmReadiness.level === 'ok'
      ? s.badgeOk
      : data.llmReadiness.level === 'warn'
        ? s.badgeWarn
        : s.badgeError;

  const readinessLabelKey =
    data.llmReadiness.level === 'ok'
      ? 'settings.llm.readiness.ok'
      : data.llmReadiness.level === 'warn'
        ? 'settings.llm.readiness.warn'
        : 'settings.llm.readiness.error';

  return (
    <>
      <div className={s.readonlyNote}>ℹ️ {t('settings.llm.readonlyNote')}</div>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.llm.readinessSection')}</h2>
        <div className={s.readinessHeader}>
          <span className={readinessBadgeClass}>{t(readinessLabelKey)}</span>
          <span className={s.readinessHint}>
            {data.llmReadiness.canTranslate
              ? t('settings.llm.readiness.translateReady')
              : t('settings.llm.readiness.translateBlocked')}
          </span>
        </div>
        <div className={s.checksGrid}>
          <span className={parentS.fieldLabel}>{t('settings.llm.checks.primaryProvider')}</span>
          <span className={s.fieldValue}>
            <span className={data.llmReadiness.checks.primaryProvider ? s.badgeOk : s.badgeError}>
              {data.llmReadiness.checks.primaryProvider
                ? t('settings.llm.checks.present')
                : t('settings.llm.checks.missing')}
            </span>
          </span>

          <span className={parentS.fieldLabel}>{t('settings.llm.checks.fallbackProvider')}</span>
          <span className={s.fieldValue}>
            <span className={data.llmReadiness.checks.fallbackProvider ? s.badgeOk : s.badgeWarn}>
              {data.llmReadiness.checks.fallbackProvider
                ? t('settings.llm.checks.present')
                : t('settings.llm.checks.optionalMissing')}
            </span>
          </span>

          <span className={parentS.fieldLabel}>{t('settings.llm.checks.translateModel')}</span>
          <span className={s.fieldValue}>
            <span className={data.llmReadiness.checks.translateModel ? s.badgeOk : s.badgeError}>
              {data.llmReadiness.checks.translateModel
                ? t('settings.llm.checks.present')
                : t('settings.llm.checks.missing')}
            </span>
          </span>

          <span className={parentS.fieldLabel}>{t('settings.llm.checks.embedModel')}</span>
          <span className={s.fieldValue}>
            <span className={data.llmReadiness.checks.embedModel ? s.badgeOk : s.badgeWarn}>
              {data.llmReadiness.checks.embedModel
                ? t('settings.llm.checks.present')
                : t('settings.llm.checks.optionalMissing')}
            </span>
          </span>
        </div>

        {data.llmReadiness.issues.length > 0 && (
          <ul className={s.issueList}>
            {data.llmReadiness.issues.map((code) => {
              const key = ISSUE_KEY_BY_CODE[code] ?? 'settings.llm.issues.unknown';
              return <li key={code}>{t(key)}</li>;
            })}
          </ul>
        )}
      </div>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.llm.providerSection')}</h2>
        <div className={parentS.fieldGrid}>
          <span className={parentS.fieldLabel}>{t('settings.llm.provider')}</span>
          <span className={s.fieldValue}>
            {data.llmProvider} <span className={s.badgeOk}>{t('common.active')}</span>
          </span>
          <span className={parentS.fieldLabel}>{t('settings.llm.fallback')}</span>
          <span className={s.fieldValue}>{data.llmFallback}</span>
          <span className={parentS.fieldLabel}>{t('settings.llm.batchSize')}</span>
          <span className={s.fieldValue}>{data.batchSize}</span>
        </div>
      </div>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.llm.vllmSection')}</h2>
        <div className={parentS.fieldGrid}>
          {data.vllmServers.length > 0 ? (
            data.vllmServers.map((server, index) => (
              <div key={`${server.host}-${index}`} className={s.serverBlock}>
                <span className={parentS.fieldLabel}>
                  {t('settings.llm.vllmServer', { index: index + 1 })}
                </span>
                <div className={s.serverFields}>
                  <div>
                    <span className={s.subLabel}>{t('settings.llm.vllmUrl')}</span>
                    <span className={s.fieldValue}>{server.host}</span>
                  </div>
                  <div>
                    <span className={s.subLabel}>{t('settings.llm.vllmMaxParallel')}</span>
                    <span className={s.fieldValue}>{server.maxParallel}</span>
                  </div>
                  <div>
                    <span className={s.subLabel}>{t('settings.llm.vllmApiKey')}</span>
                    <span className={s.fieldValue}>
                      <span className={server.apiKeyConfigured ? s.badgeOk : s.badgeWarn}>
                        {server.apiKeyConfigured
                          ? t('settings.llm.keySet')
                          : t('settings.llm.keyNotSet')}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <>
              <span className={parentS.fieldLabel}>{t('settings.llm.vllmUrl')}</span>
              <span className={s.fieldValue}>{data.vllmBaseUrl}</span>
            </>
          )}
          <span className={parentS.fieldLabel}>{t('settings.llm.llmMaxParallelTotal')}</span>
          <span className={s.fieldValue}>{data.llmMaxParallel}</span>
          <span className={parentS.fieldLabel}>{t('settings.llm.vllmModel')}</span>
          <span className={s.fieldValue}>{data.vllmModel || '—'}</span>
          <span className={parentS.fieldLabel}>{t('settings.llm.vllmEmbedModel')}</span>
          <span className={s.fieldValue}>{data.vllmEmbedModel || '—'}</span>
        </div>
      </div>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.llm.openaiSection')}</h2>
        <div className={parentS.fieldGrid}>
          <span className={parentS.fieldLabel}>{t('settings.llm.openaiKey')}</span>
          <span className={s.fieldValue}>
            <span className={data.openaiKeyConfigured ? s.badgeOk : s.badgeWarn}>
              {data.openaiKeyConfigured ? t('settings.llm.keySet') : t('settings.llm.keyNotSet')}
            </span>
          </span>
          <span className={parentS.fieldLabel}>{t('settings.llm.translateModel')}</span>
          <span className={s.fieldValue}>{data.translateModel || '—'}</span>
          <span className={parentS.fieldLabel}>{t('settings.llm.embedModel')}</span>
          <span className={s.fieldValue}>{data.embedModel || '—'}</span>
        </div>
      </div>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.llm.nexusSection')}</h2>
        <div className={parentS.fieldGrid}>
          <span className={parentS.fieldLabel}>{t('settings.llm.nexusApiKey')}</span>
          <span className={s.fieldValue}>
            <span className={data.nexusApiKeyConfigured ? s.badgeOk : s.badgeWarn}>
              {data.nexusApiKeyConfigured ? t('settings.llm.keySet') : t('settings.llm.keyNotSet')}
            </span>
          </span>
        </div>
      </div>
    </>
  );
};
