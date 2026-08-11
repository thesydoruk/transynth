import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import { Button } from '../../../components/Button';
import parentS from '../SettingsPage.module.scss';
import s from './LlmTab.module.scss';

export type VllmServerDraft = {
  host: string;
  maxParallel: number;
  apiKey: string;
};

type LiveServerHealth = {
  host: string;
  healthy: boolean;
};

type VllmPoolEditorProps = {
  savedServers: VllmServerDraft[];
  /** Effective runtime servers when the project setting is still empty (env fallback). */
  fallbackServers: VllmServerDraft[];
  liveServers: LiveServerHealth[];
  totalParallel: number;
};

const emptyServer = (): VllmServerDraft => ({ host: '', maxParallel: 2, apiKey: '' });

const cloneServers = (servers: VllmServerDraft[]): VllmServerDraft[] =>
  servers.map((server) => ({ ...server }));

/** Editable vLLM chat pool stored in project_settings (`llm.vllm_servers`). */
export const VllmPoolEditor = ({
  savedServers,
  fallbackServers,
  liveServers,
  totalParallel,
}: VllmPoolEditorProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const usingFallback = savedServers.length === 0;
  const [draft, setDraft] = useState<VllmServerDraft[]>(() =>
    cloneServers(usingFallback ? fallbackServers : savedServers),
  );
  const [error, setError] = useState<string | null>(null);

  const savedKey = JSON.stringify(savedServers);
  const fallbackKey = JSON.stringify(fallbackServers);
  useEffect(() => {
    setDraft(cloneServers(savedServers.length > 0 ? savedServers : fallbackServers));
    // Intentional: resync only when persisted/fallback server lists change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare via JSON keys
  }, [savedKey, fallbackKey]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (servers: VllmServerDraft[]) =>
      api.projectSettings.update('llm.vllm_servers', servers),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['projectSettings'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const updateRow = (index: number, patch: Partial<VllmServerDraft>) => {
    setDraft((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSave = () => {
    const cleaned = draft
      .map((row) => ({
        host: row.host.trim(),
        maxParallel: Math.min(32, Math.max(1, Math.round(Number(row.maxParallel) || 1))),
        apiKey: row.apiKey,
      }))
      .filter((row) => row.host.length > 0);
    if (cleaned.length === 0) {
      setError(t('settings.llm.vllmPoolEmptyError'));
      return;
    }
    save(cleaned);
  };

  return (
    <div className={parentS.section}>
      <h2 className={parentS.sectionTitle}>{t('settings.llm.vllmPoolSection')}</h2>
      <p className={parentS.fieldNote}>{t('settings.llm.vllmPoolDesc')}</p>
      {usingFallback && (
        <div className={s.readonlyNote}>ℹ️ {t('settings.llm.vllmPoolFallback')}</div>
      )}

      {draft.map((server, index) => {
        const live = liveServers.find((row) => row.host === server.host.trim());
        const healthy = live?.healthy ?? true;
        return (
          <div key={index} className={s.serverEditBlock}>
            <div className={s.serverEditHeader}>
              <span className={parentS.fieldLabel}>
                {t('settings.llm.vllmServer', { index: index + 1 })}{' '}
                <span className={healthy ? s.badgeOk : s.badgeError}>
                  {healthy ? t('settings.llm.vllmHealthy') : t('settings.llm.vllmUnhealthy')}
                </span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={draft.length <= 1 || isPending}
                onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              >
                {t('settings.llm.vllmPoolRemove')}
              </Button>
            </div>
            <div className={s.serverEditGrid}>
              <label className={s.editField}>
                <span className={s.subLabel}>{t('settings.llm.vllmUrl')}</span>
                <input
                  className={s.input}
                  value={server.host}
                  onChange={(e) => updateRow(index, { host: e.target.value })}
                  placeholder="http://192.168.50.161:8011"
                  disabled={isPending}
                />
              </label>
              <label className={s.editField}>
                <span className={s.subLabel}>{t('settings.llm.vllmMaxParallel')}</span>
                <input
                  className={s.input}
                  type="number"
                  min={1}
                  max={32}
                  value={server.maxParallel}
                  onChange={(e) => updateRow(index, { maxParallel: Number(e.target.value) })}
                  disabled={isPending}
                />
              </label>
              <label className={s.editField}>
                <span className={s.subLabel}>{t('settings.llm.vllmApiKey')}</span>
                <input
                  className={s.input}
                  type="password"
                  value={server.apiKey}
                  onChange={(e) => updateRow(index, { apiKey: e.target.value })}
                  placeholder={t('settings.llm.vllmApiKeyOptional')}
                  disabled={isPending}
                  autoComplete="off"
                />
              </label>
            </div>
          </div>
        );
      })}

      <div className={s.poolActions}>
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() => setDraft((prev) => [...prev, emptyServer()])}
        >
          {t('settings.llm.vllmPoolAdd')}
        </Button>
        <Button variant="success" size="sm" disabled={isPending} onClick={handleSave}>
          {isPending ? t('settings.llm.vllmPoolSaving') : t('settings.llm.vllmPoolSave')}
        </Button>
        <span className={s.fieldValue}>
          {t('settings.llm.llmMaxParallelTotal')}: {totalParallel}
        </span>
      </div>
      {error && <p className={s.error}>{error}</p>}
    </div>
  );
};
