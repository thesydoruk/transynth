import { useTranslation } from 'react-i18next';
import type { Mod } from '../../../api';
import s from '../GlossaryPage.module.scss';

type GlossaryEnforcePanelProps = {
  mods: Mod[] | undefined;
  enforceModId: number | '';
  onModChange: (modId: number | '') => void;
  onEnforce: () => void;
  enforcePending: boolean;
  enforceSuccess: boolean;
  checked?: number;
  violations?: number;
  enforceError?: string;
};

export const GlossaryEnforcePanel = ({
  mods,
  enforceModId,
  onModChange,
  onEnforce,
  enforcePending,
  enforceSuccess,
  checked,
  violations,
  enforceError,
}: GlossaryEnforcePanelProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.enforcePanel}>
      <span className={s.enforceLabel}>{t('glossary.enforceLabel')}</span>
      <select
        value={enforceModId}
        onChange={(e) => onModChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={s.selectIndent}
      >
        <option value="">{t('glossary.allMods')}</option>
        {mods?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <button onClick={onEnforce} disabled={enforcePending} className={s.btnEnforce}>
        {enforcePending ? t('glossary.enforcing') : t('glossary.enforceBtn')}
      </button>
      {enforceSuccess && (
        <span className={s.enforceResult}>
          {t('glossary.enforceResult', { checked, violations })}
        </span>
      )}
      {enforceError && <span className={s.addError}>{enforceError}</span>}
    </div>
  );
};
