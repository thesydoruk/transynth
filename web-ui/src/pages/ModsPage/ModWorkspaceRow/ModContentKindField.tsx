import { useTranslation } from 'react-i18next';
import type { Mod, ModContentKind } from '../../../api';
import s from './ModWorkspaceRow.module.scss';

const KIND_OPTIONS: ModContentKind[] = ['base', 'dlc', 'addon', 'mod'];

/** The row menu's content-type picker; "auto" goes back to the detected kind. */
export const ModContentKindField = ({
  mod,
  onChange,
}: {
  mod: Mod;
  onChange: (kind: ModContentKind | null) => void;
}) => {
  const { t } = useTranslation();
  return (
    <label className={s.kindField}>
      <span>{t('mods.contentType')}</span>
      <select
        value={mod.content_kind_manual ? mod.content_kind : 'auto'}
        onChange={(e) =>
          onChange(e.target.value === 'auto' ? null : (e.target.value as ModContentKind))
        }
      >
        <option value="auto">
          {mod.content_kind_manual
            ? t('mods.contentAuto')
            : t('mods.contentAutoKind', { kind: t(`mods.kind.${mod.content_kind}`) })}
        </option>
        {KIND_OPTIONS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`mods.kind.${kind}`)}
          </option>
        ))}
      </select>
    </label>
  );
};
