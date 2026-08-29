import type { VoiceFileEntry } from '../../../../voice/discoverVoiceFiles';
import type { InheritedVoiceLookup, MasterModRef } from '../../../../voice/inheritedVoiceText';
import { voiceTranslationMapKey } from '../../../../voice/loadVoiceTranslations';
import { collectVoiceSourceFormids } from '../../../../voice/voiceSourceFormids';
import { isOrphanVoiceEntry } from '../buildVoiceLinePreview';

const entry = (formidLower6: string, variant: number): VoiceFileEntry => ({
  relPath: `Sound/Voice/Mod.esp/Speaker/00${formidLower6}_${variant}.fuz`,
  absolutePath: `/data/Sound/Voice/Mod.esp/Speaker/00${formidLower6}_${variant}.fuz`,
  fileName: `00${formidLower6}_${variant}.fuz`,
  formidLower6,
  variant,
  ext: 'fuz',
});

const master: MasterModRef = {
  modId: 7,
  modName: 'Fallout 4',
  pluginName: 'Fallout4.esm',
};

describe('collectVoiceSourceFormids', () => {
  it('collects FormIDs from local sources and translations', () => {
    const formids = collectVoiceSourceFormids(
      new Map([[voiceTranslationMapKey('002CBA', 1), {}]]),
      new Map([[voiceTranslationMapKey('002D7A', 3), {}]]),
      null,
    );

    expect([...formids].sort()).toEqual(['002CBA', '002D7A']);
  });

  it('includes FormIDs inherited from imported masters', () => {
    const inherited: InheritedVoiceLookup = {
      masters: [master],
      sourcesByMod: new Map([
        [master.modId, new Map([[voiceTranslationMapKey('008EC5', 1), {} as never]])],
      ]),
      translationsByMod: new Map([
        [master.modId, new Map([[voiceTranslationMapKey('008EC6', 1), {} as never]])],
      ]),
    };

    const formids = collectVoiceSourceFormids(new Map(), new Map(), inherited);
    expect([...formids].sort()).toEqual(['008EC5', '008EC6']);
  });
});

describe('isOrphanVoiceEntry', () => {
  it('treats audio with a matching record as normal, any variant', () => {
    const formids = new Set(['002CBA']);
    expect(isOrphanVoiceEntry(formids, entry('002CBA', 1))).toBe(false);
    expect(isOrphanVoiceEntry(formids, entry('002CBA', 4))).toBe(false);
  });

  it('flags audio whose FormID has no record at all', () => {
    expect(isOrphanVoiceEntry(new Set(['002D7A']), entry('002D79', 1))).toBe(true);
  });
});
