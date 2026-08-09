import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import parentS from '../SettingsPage.module.scss';
import { CharacterLinksTable } from './CharacterLinksTable';
import { VoiceLibraryTable } from './VoiceLibraryTable';
import s from './UkVoicesTab.module.scss';

/** Ukrainian reference library + per-character links (global, not mod-scoped). */
export const UkVoicesTab = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const voicesQuery = useQuery({
    queryKey: ['ukVoices'],
    queryFn: api.ukVoices.list,
  });
  const charactersQuery = useQuery({
    queryKey: ['ukVoiceCharacters'],
    queryFn: api.ukVoices.characters,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ukVoices'] }),
      queryClient.invalidateQueries({ queryKey: ['ukVoiceCharacters'] }),
    ]);
  };

  const importMutation = useMutation({
    mutationFn: () => api.ukVoices.importLibrary(),
    onSuccess: invalidate,
  });
  const linkMutation = useMutation({
    mutationFn: ({ characterKey, voiceId }: { characterKey: string; voiceId: string }) =>
      api.ukVoices.link(characterKey, voiceId),
    onSuccess: invalidate,
  });
  const unlinkMutation = useMutation({
    mutationFn: (characterKey: string) => api.ukVoices.unlink(characterKey),
    onSuccess: invalidate,
  });

  if (voicesQuery.isLoading || charactersQuery.isLoading) {
    return <div className={s.center}>{t('common.loading')}</div>;
  }
  if (voicesQuery.error || charactersQuery.error) {
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', {
          message: String(voicesQuery.error ?? charactersQuery.error),
        })}
      </div>
    );
  }

  const voices = voicesQuery.data?.voices ?? [];
  const characters = charactersQuery.data?.characters ?? [];
  const linking = linkMutation.isPending || unlinkMutation.isPending;

  return (
    <>
      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.ukVoices.libraryTitle')}</h2>
        <p className={s.hint}>{t('settings.ukVoices.libraryDesc')}</p>
        <div className={s.toolbar}>
          <button
            type="button"
            className={s.button}
            disabled={importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending
              ? t('settings.ukVoices.importing')
              : t('settings.ukVoices.importLibrary')}
          </button>
        </div>
        {importMutation.isSuccess ? (
          <p className={s.hint}>
            {t('settings.ukVoices.importDone', {
              opentts: importMutation.data.opentts,
              commonVoice: importMutation.data.commonVoice,
            })}
          </p>
        ) : null}
        {importMutation.error ? (
          <p className={`${s.hint} ${s.error}`}>{String(importMutation.error)}</p>
        ) : null}
        <VoiceLibraryTable voices={voices} />
      </div>

      <div className={parentS.section}>
        <h2 className={parentS.sectionTitle}>{t('settings.ukVoices.charactersTitle')}</h2>
        <p className={s.hint}>{t('settings.ukVoices.charactersDesc')}</p>
        <CharacterLinksTable
          characters={characters}
          voices={voices}
          busy={linking}
          onLink={(characterKey, voiceId) => linkMutation.mutate({ characterKey, voiceId })}
          onUnlink={(characterKey) => unlinkMutation.mutate(characterKey)}
        />
      </div>
    </>
  );
};
