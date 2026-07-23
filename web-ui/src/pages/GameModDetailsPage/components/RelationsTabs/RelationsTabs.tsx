import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NexusModRelationsResult, NexusTranslationsResult } from '../../../../api';
import { RelationsTabContent } from '../../RelationsTabContent';
import { TranslationListItem } from '../../TranslationListItem';
import { groupTranslationsByLanguage } from '../../utils/translationGrouping';
import s from './RelationsTabs.module.scss';

type RelationsTabKey = 'translations' | 'requires' | 'requiredBy';

type RelationsTabsProps = {
  gameDomain: string;
  translations: NexusTranslationsResult | undefined;
  isTranslationsLoading: boolean;
  translationsError: unknown;
  relations: NexusModRelationsResult | undefined;
  isRelationsLoading: boolean;
  relationsError: unknown;
};

export const RelationsTabs = ({
  gameDomain,
  translations,
  isTranslationsLoading,
  translationsError,
  relations,
  isRelationsLoading,
  relationsError,
}: RelationsTabsProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<RelationsTabKey>('translations');

  const groupedTranslations = useMemo(
    () => groupTranslationsByLanguage(translations?.items ?? []),
    [translations?.items],
  );

  return (
    <section className={s.section}>
      <h2 className={s.h2}>{t('games.relationsTitle')}</h2>

      <div className={s.tabs} role="tablist" aria-label={t('games.relationsTitle')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'translations'}
          className={activeTab === 'translations' ? `${s.tab} ${s.tabActive}` : s.tab}
          onClick={() => setActiveTab('translations')}
        >
          {t('games.tabTranslations')}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'requires'}
          className={activeTab === 'requires' ? `${s.tab} ${s.tabActive}` : s.tab}
          onClick={() => setActiveTab('requires')}
        >
          {t('games.tabRequires')}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'requiredBy'}
          className={activeTab === 'requiredBy' ? `${s.tab} ${s.tabActive}` : s.tab}
          onClick={() => setActiveTab('requiredBy')}
        >
          {t('games.tabRequiredBy')}
        </button>
      </div>

      {activeTab === 'translations' && (
        <div role="tabpanel" className={s.tabPanel}>
          {translationsError != null && (
            <p className={s.error}>{t('common.error', { message: String(translationsError) })}</p>
          )}
          {isTranslationsLoading && <p className={s.loading}>{t('common.loading')}</p>}
          {!isTranslationsLoading &&
            translations &&
            (groupedTranslations.length === 0 ? (
              <p className={s.empty}>{t('games.noTranslations')}</p>
            ) : (
              <div className={s.translationGroups}>
                {groupedTranslations.map((group) => (
                  <section className={s.translationGroup} key={group.key}>
                    <h3 className={s.translationGroupTitle}>
                      <span className={s.languageFlag} aria-hidden="true">
                        {group.flagImageUrl ? (
                          <img
                            src={group.flagImageUrl}
                            alt=""
                            className={s.languageFlagImage}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span className={s.languageFlagFallback}>?</span>
                        )}
                      </span>
                      <span>{t(group.labelKey)}</span>
                      <span className={s.groupCount}>
                        {t('games.groupCountLabel', { count: group.items.length })}
                      </span>
                    </h3>

                    <ul className={s.translationList}>
                      {group.items.map((row) => (
                        <TranslationListItem
                          key={`${row.mod.game.domainName}-${row.mod.modId}`}
                          gameDomain={gameDomain}
                          row={row}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ))}
        </div>
      )}

      {activeTab === 'requires' && (
        <div role="tabpanel" className={s.tabPanel}>
          <RelationsTabContent
            isLoading={isRelationsLoading}
            error={relationsError}
            emptyText={t('games.noRequires')}
            gameDomain={gameDomain}
            items={relations?.requires ?? []}
          />
        </div>
      )}

      {activeTab === 'requiredBy' && (
        <div role="tabpanel" className={s.tabPanel}>
          <RelationsTabContent
            isLoading={isRelationsLoading}
            error={relationsError}
            emptyText={t('games.noRequiredBy')}
            gameDomain={gameDomain}
            items={relations?.requiredBy ?? []}
          />
        </div>
      )}
    </section>
  );
};
