import { useTranslation } from 'react-i18next';
import type { NexusModDetails } from '../../../../api';
import { renderNexusDescription } from '../../utils/nexusDescription';
import s from './ModInfoSection.module.scss';

type ModInfoSectionProps = {
  details: NexusModDetails;
};

export const ModInfoSection = ({ details }: ModInfoSectionProps) => {
  const { t } = useTranslation();

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('games.modInfo')}</h2>

      {details.mod.pictureUrl && (
        <div className={s.heroWrap}>
          <img
            src={details.mod.pictureUrl}
            alt={details.mod.name}
            className={s.heroImage}
            loading="lazy"
          />
        </div>
      )}

      <p className={s.summary}>{details.mod.summary || t('games.noSummary')}</p>
      <div className={s.metaGrid}>
        <span className={s.chip}>
          {t('games.downloads', { count: details.mod.downloads.toLocaleString() })}
        </span>
        <span className={s.chip}>
          {t('games.endorsements', { count: details.mod.endorsements.toLocaleString() })}
        </span>
        <span className={s.chip}>{details.mod.version}</span>
        <span className={s.chip}>{details.mod.category ?? '-'}</span>
      </div>
      {details.mod.description && (
        <div
          className={s.description}
          dangerouslySetInnerHTML={{
            __html: renderNexusDescription(details.mod.description),
          }}
        />
      )}
    </section>
  );
};
