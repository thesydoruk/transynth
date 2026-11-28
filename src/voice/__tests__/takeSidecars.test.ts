import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import {
  copyTakeSidecars,
  removeVoiceTake,
  takeOnDisk,
  takeSidecarPath,
  writeVoiceTake,
  writeVoiceTakeIfChanged,
} from '../takeSidecars';
import { FUZ_TAKES, LOCALIZED_TAKE_EXTENSIONS, wemFfxanimTakes } from '../takeFormat';
import { loadTakeSpeakerSexResolver, takeSpeakerSex } from '../takeSpeakerSex';

const FFXANIM = ['.ffxanim'];

describe('files that travel with a take', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'take-sidecars-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const built = (take: string, animation: string) => ({
    data: Buffer.from(take),
    sidecars: [{ extension: '.ffxanim', data: Buffer.from(animation) }],
  });

  it('names a sidecar after the take', () => {
    expect(takeSidecarPath(path.join('a', 'Npc', '00ae4a02.wem'), '.ffxanim')).toBe(
      path.join('a', 'Npc', '00ae4a02.ffxanim'),
    );
    expect(takeSidecarPath('Fallout4.esm/00012345_1.fuz', '.lip')).toBe(
      'Fallout4.esm/00012345_1.lip',
    );
  });

  it('writes the take with its sidecars and sees it only when all are there', () => {
    const take = path.join(dir, 'Sound', 'Voice', 'Mod.esm', 'Npc', '00ae4a02.wem');
    writeVoiceTake(take, built('wem', 'anim'));
    expect(fs.readFileSync(take, 'utf8')).toBe('wem');
    expect(fs.readFileSync(takeSidecarPath(take, '.ffxanim'), 'utf8')).toBe('anim');
    expect(takeOnDisk(take, FFXANIM)).toBe(true);

    fs.rmSync(takeSidecarPath(take, '.ffxanim'));
    expect(takeOnDisk(take, FFXANIM)).toBe(false);
    // A format with nothing beside the take asks for nothing more than the file.
    expect(takeOnDisk(take, [])).toBe(true);
    expect(takeOnDisk(path.join(dir, 'missing.fuz'), [])).toBe(false);
  });

  it('reports an unchanged take as unchanged but still restores its sidecar', () => {
    const take = path.join(dir, 'Npc', '00ae4a02.wem');
    expect(writeVoiceTakeIfChanged(take, built('wem', 'anim'), null)).toBe(true);
    fs.rmSync(takeSidecarPath(take, '.ffxanim'));
    expect(writeVoiceTakeIfChanged(take, built('wem', 'anim'), take)).toBe(false);
    expect(takeOnDisk(take, FFXANIM)).toBe(true);
    expect(writeVoiceTakeIfChanged(take, built('wem2', 'anim2'), take)).toBe(true);
    expect(fs.readFileSync(takeSidecarPath(take, '.ffxanim'), 'utf8')).toBe('anim2');
  });

  it('copies the sidecars a take has, under the name of the copy', async () => {
    const from = path.join(dir, 'store', 'abc-123.wem');
    writeVoiceTake(from, built('wem', 'anim'));
    const to = path.join(dir, 'mod', '00ae4a02.wem');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);

    await copyTakeSidecars(from, to, FFXANIM);
    expect(fs.readFileSync(path.join(dir, 'mod', '00ae4a02.ffxanim'), 'utf8')).toBe('anim');
    // Nothing to copy is not an error.
    await copyTakeSidecars(path.join(dir, 'store', 'none.wem'), to, FFXANIM);
    await copyTakeSidecars(from, to, []);
  });

  it('removes a take with its sidecars and says whether the take was there', () => {
    const take = path.join(dir, 'Npc', '00ae4a02.wem');
    writeVoiceTake(take, built('wem', 'anim'));
    const neighbour = path.join(dir, 'Npc', '00ae4a03.wem');
    writeVoiceTake(neighbour, built('wem', 'anim'));

    expect(removeVoiceTake(take, FFXANIM)).toBe(true);
    expect(fs.existsSync(take)).toBe(false);
    expect(fs.existsSync(takeSidecarPath(take, '.ffxanim'))).toBe(false);
    expect(takeOnDisk(neighbour, FFXANIM)).toBe(true);

    // A sidecar left behind by a take that is already gone goes too.
    fs.writeFileSync(takeSidecarPath(take, '.ffxanim'), 'stale');
    expect(removeVoiceTake(take, FFXANIM)).toBe(false);
    expect(fs.existsSync(takeSidecarPath(take, '.ffxanim'))).toBe(false);
    expect(removeVoiceTake(take, [])).toBe(false);
  });

  it('lists what every format leaves in a localize tree', () => {
    expect(LOCALIZED_TAKE_EXTENSIONS).toEqual({ takes: ['fuz', 'wem'], sidecars: ['ffxanim'] });
  });
});

describe('sex of the speaker behind a voice folder', () => {
  const stored = new Map<string, 'male' | 'female'>([
    ['crowdvoice01', 'female'],
    ['npcfandreja', 'male'],
  ]);

  it('trusts what the import stored over the folder name', () => {
    expect(takeSpeakerSex(stored, 'CrowdVoice01')).toBe('female');
    expect(takeSpeakerSex(stored, 'NPCFAndreja')).toBe('male');
  });

  it('falls back to the folder name, then to male', () => {
    expect(takeSpeakerSex(stored, 'npcfsarahmorgan')).toBe('female');
    expect(takeSpeakerSex(stored, 'NPCMBarrett')).toBe('male');
    expect(takeSpeakerSex(stored, 'FemaleEvenToned')).toBe('female');
    expect(takeSpeakerSex(stored, 'RobotModelA')).toBe('male');
    expect(takeSpeakerSex(stored, 'Vasco')).toBe('male');
    // The player has no sex of their own; the default rig stands in.
    expect(takeSpeakerSex(stored, 'PlayerVoiceFemale01')).toBe('male');
    expect(takeSpeakerSex(stored, '')).toBe('male');
    expect(takeSpeakerSex(stored, null)).toBe('male');
  });

  it('asks the database only for a format that needs it', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return {
          rows: [
            { speaker_key: 'voice:NPCFAndreja', voice_type: null, effective_gender: 'female' },
            { speaker_key: 'npc:00012345', voice_type: 'CrewEliteVoice', effective_gender: 'male' },
            {
              speaker_key: 'npc:00012346',
              voice_type: 'MysteryVoice',
              effective_gender: 'unknown',
            },
          ],
        };
      },
    } as unknown as Tx;

    expect(await loadTakeSpeakerSexResolver(db, 1, FUZ_TAKES)).toBeUndefined();
    expect(queries).toHaveLength(0);

    const sexOf = await loadTakeSpeakerSexResolver(db, 1, wemFfxanimTakes('opus'));
    expect(queries).toHaveLength(1);
    expect(sexOf?.('npcfandreja')).toBe('female');
    expect(sexOf?.('CrewEliteVoice')).toBe('male');
    expect(sexOf?.('MysteryVoice')).toBe('male');
  });
});
