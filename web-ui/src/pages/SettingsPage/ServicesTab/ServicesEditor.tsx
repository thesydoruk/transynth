import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import type { ServiceKind } from '../../../api';
import { Button } from '../../../components/Button';
import parentS from '../SettingsPage.module.scss';
import s from './ServicesTab.module.scss';

const SERVICE_KINDS: ServiceKind[] = ['llm', 'embed', 'tts', 'asr', 'separate', 'tools'];

type ServiceRowDraft = {
  kind: ServiceKind;
  host: string;
  maxParallel: number;
  apiKey: string;
  managed: boolean;
  apiKeyConfigured: boolean;
};

export type SavedServiceRow = {
  kind: ServiceKind;
  host: string;
  maxParallel: number;
  managed?: boolean;
  apiKeyConfigured?: boolean;
};

const emptyRow = (): ServiceRowDraft => ({
  kind: 'llm',
  host: '',
  maxParallel: 2,
  apiKey: '',
  managed: false,
  apiKeyConfigured: false,
});

const toDrafts = (rows: SavedServiceRow[]): ServiceRowDraft[] =>
  rows.map((row) => ({
    kind: row.kind,
    host: row.host,
    maxParallel: row.maxParallel,
    apiKey: '',
    managed: row.managed === true,
    apiKeyConfigured: row.apiKeyConfigured === true,
  }));

type ServicesEditorProps = {
  savedRows: SavedServiceRow[];
};

/** Editable `services.endpoints` project setting; managed rows are shown read-only. */
export const ServicesEditor = ({ savedRows }: ServicesEditorProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ServiceRowDraft[]>(() => toDrafts(savedRows));
  const [error, setError] = useState<string | null>(null);

  const savedKey = JSON.stringify(savedRows);
  useEffect(() => {
    setDraft(toDrafts(savedRows));
    // Intentional: resync only when the persisted rows change (compared by JSON).
  }, [savedKey]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (rows: Array<Record<string, unknown>>) =>
      api.projectSettings.update('services.endpoints', rows),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['projectSettings'] });
      await queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : String(err));
    },
  });

  const updateRow = (index: number, patch: Partial<ServiceRowDraft>) => {
    setDraft((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSave = () => {
    const cleaned = draft
      .map((row) => ({
        kind: row.kind,
        host: row.host.trim(),
        maxParallel: Math.min(32, Math.max(1, Math.round(Number(row.maxParallel) || 1))),
        apiKey: row.apiKey,
        managed: row.managed,
      }))
      .filter((row) => row.host.length > 0);
    save(cleaned);
  };

  return (
    <div className={parentS.section}>
      <h2 className={parentS.sectionTitle}>{t('settings.services.editorSection')}</h2>
      <p className={parentS.fieldNote}>{t('settings.services.editorDesc')}</p>

      {draft.map((row, index) => (
        <div key={index} className={s.editBlock}>
          <div className={s.editHeader}>
            <span className={parentS.fieldLabel}>
              {t('settings.services.row', { index: index + 1 })}
              {row.managed && <> · {t('settings.services.managed')}</>}
            </span>
            {!row.managed && (
              <Button
                variant="secondary"
                size="sm"
                disabled={isPending}
                onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              >
                {t('settings.services.remove')}
              </Button>
            )}
          </div>
          {row.managed && <div className={s.note}>{t('settings.services.managedNote')}</div>}
          <div className={s.editGrid}>
            <label className={s.editField}>
              <span className={s.subLabel}>{t('settings.services.kind')}</span>
              <select
                className={s.input}
                value={row.kind}
                onChange={(e) => updateRow(index, { kind: e.target.value as ServiceKind })}
                disabled={isPending || row.managed}
              >
                {SERVICE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.editField}>
              <span className={s.subLabel}>{t('settings.services.host')}</span>
              <input
                className={s.input}
                value={row.host}
                onChange={(e) => updateRow(index, { host: e.target.value })}
                placeholder="http://localhost:8000"
                disabled={isPending || row.managed}
              />
            </label>
            <label className={s.editField}>
              <span className={s.subLabel}>{t('settings.services.maxParallel')}</span>
              <input
                className={s.input}
                type="number"
                min={1}
                max={32}
                value={row.maxParallel}
                onChange={(e) => updateRow(index, { maxParallel: Number(e.target.value) })}
                disabled={isPending || row.managed}
              />
            </label>
            <label className={s.editField}>
              <span className={s.subLabel}>{t('settings.services.apiKey')}</span>
              <input
                className={s.input}
                type="password"
                value={row.apiKey}
                onChange={(e) => updateRow(index, { apiKey: e.target.value })}
                placeholder={
                  row.apiKeyConfigured
                    ? t('settings.services.apiKeyUnchanged')
                    : t('settings.services.apiKeyOptional')
                }
                disabled={isPending || row.managed}
                autoComplete="off"
              />
            </label>
          </div>
        </div>
      ))}

      <div className={s.actions}>
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() => setDraft((prev) => [...prev, emptyRow()])}
        >
          {t('settings.services.add')}
        </Button>
        <Button variant="success" size="sm" disabled={isPending} onClick={handleSave}>
          {isPending ? t('settings.services.saving') : t('settings.services.save')}
        </Button>
      </div>
      {error && <p className={s.error}>{error}</p>}
    </div>
  );
};
