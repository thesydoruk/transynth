import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportArchiveRow } from '../ExportArchiveRow';
import { useModsWorkspace } from '../ModsWorkspaceContext';
import s from './ModsSections.module.scss';

/** Export archives, folded away until asked for — or until one is being built. */
export const ExportsSection = () => {
  const { t } = useTranslation();
  const { exportArchives } = useModsWorkspace();
  const { archives, deletingId, remove } = exportArchives;
  const running = archives.some((archive) => archive.status === 'running');
  const [open, setOpen] = useState(running);

  // A started export must be seen without hunting for it; closing it by hand still works.
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  if (archives.length === 0) return null;

  return (
    <details
      className={s.section}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={s.summary}>
        {t('mods.sections.exportsTitle', { count: archives.length })}
      </summary>
      <div className={s.list}>
        {archives.map((archive) => (
          <ExportArchiveRow
            key={`export-${archive.id}`}
            archive={archive}
            deleting={deletingId === archive.id}
            onDelete={() => void remove(archive)}
          />
        ))}
      </div>
    </details>
  );
};
