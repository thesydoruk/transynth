import type { Tx } from '../../../../db';
import {
  formatVoiceFolderName,
  loadVoiceFolderNames,
  withDistinctSpeakerNames,
} from '../speakerLabels';
import { formatVoiceSpeakerLabel } from '../voiceEntries';

const dbWith = (rows: Array<{ voice_type: string; display_name: string | null }>): Tx =>
  ({ query: async () => ({ rows }) }) as unknown as Tx;

describe('formatVoiceFolderName', () => {
  it('keeps the whole name and splits it into words', () => {
    expect(formatVoiceFolderName('NPCXOtherPlayer_2')).toBe('NPCX Other Player 2');
    expect(formatVoiceFolderName('UnityVoiceNonBinary_2')).toBe('Unity Voice Non Binary 2');
    expect(formatVoiceFolderName('crmantida_base')).toBe('crmantida base');
    expect(formatVoiceFolderName('GenericFemale01')).toBe('Generic Female 01');
  });
});

describe('loadVoiceFolderNames', () => {
  it("gives a lower-case folder the plugin's spelling and its one character", async () => {
    const names = await loadVoiceFolderNames(
      dbWith([
        { voice_type: 'NPCMAaronScott', display_name: 'Aaron Scott' },
        { voice_type: 'GenericFemale01', display_name: 'Spacer' },
        { voice_type: 'GenericFemale01', display_name: 'Tourist' },
        { voice_type: 'GenericFemale01', display_name: null },
        { voice_type: 'RobotModelA', display_name: ' ' },
      ]),
      272,
    );

    expect(names.get('npcmaaronscott')).toEqual({
      spelling: 'NPCMAaronScott',
      character: 'Aaron Scott',
    });
    // A voice type many characters share names none of them.
    expect(names.get('genericfemale01')).toEqual({ spelling: 'GenericFemale01', character: null });
    expect(names.get('robotmodela')).toEqual({ spelling: 'RobotModelA', character: null });
    // With the spelling back, the label splits into words again.
    expect(formatVoiceSpeakerLabel(names.get('genericfemale01')!.spelling)).toBe(
      'Generic Female 01',
    );
  });
});

describe('withDistinctSpeakerNames', () => {
  it('shows speakers that share a label by their folders, and leaves the rest', () => {
    const speakers = [
      { key: 'npcxotherplayer_2', displayName: formatVoiceSpeakerLabel('npcxotherplayer_2') },
      {
        key: 'unityvoicenonbinary_2',
        displayName: formatVoiceSpeakerLabel('unityvoicenonbinary_2'),
      },
      { key: 'npcmaaronscott', displayName: 'Aaron Scott' },
      { key: 'genericmale03', displayName: 'Spacer' },
      { key: 'genericmale04', displayName: 'spacer ' },
    ];
    // The rule that drops a mod prefix leaves both of the first two as "2".
    expect(speakers[0]!.displayName).toBe('2');
    expect(speakers[1]!.displayName).toBe('2');

    const spelling: Record<string, string> = {
      npcxotherplayer_2: 'NPCXOtherPlayer_2',
      unityvoicenonbinary_2: 'UnityVoiceNonBinary_2',
      genericmale03: 'GenericMale03',
      genericmale04: 'GenericMale04',
    };
    const named = withDistinctSpeakerNames(speakers, (key) =>
      formatVoiceFolderName(spelling[key] ?? key),
    );

    expect(named.map((speaker) => speaker.displayName)).toEqual([
      'NPCX Other Player 2',
      'Unity Voice Non Binary 2',
      'Aaron Scott',
      'Generic Male 03',
      'Generic Male 04',
    ]);
    expect(named[2]).toBe(speakers[2]);
    expect(new Set(named.map((speaker) => speaker.displayName)).size).toBe(named.length);
  });
});
