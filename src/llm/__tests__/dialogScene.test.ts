import { dialogScenePayload, windowDialogSceneTurns, type DialogSceneTurn } from '../dialogScene';
import { chunkFo4DialogFamily, type Fo4DialogGroupRow } from '../fo4DialogChunks';

const turn = (id: number, source: string, opts?: Partial<DialogSceneTurn>): DialogSceneTurn => ({
  id,
  kind: 'response',
  speaker: 'Preston',
  source,
  translate: true,
  ...opts,
});

describe('windowDialogSceneTurns', () => {
  it('keeps a short scene in one window', () => {
    const turns = [turn(1, 'A'), turn(2, 'B'), turn(3, 'C')];
    expect(windowDialogSceneTurns(turns, { maxTargets: 10 })).toEqual([turns]);
  });

  it('slides long scenes and marks neighbors', () => {
    const turns = [1, 2, 3, 4, 5, 6].map((id) => turn(id, `L${id}`));
    const [first, second] = windowDialogSceneTurns(turns, { maxTargets: 3, neighbors: 1 });
    expect(first?.map((row) => row.id)).toEqual([1, 2, 3, 4]);
    expect(first?.filter((row) => row.translate).map((row) => row.id)).toEqual([1, 2, 3]);
    expect(second?.map((row) => row.id)).toEqual([3, 4, 5, 6]);
    expect(second?.filter((row) => row.translate).map((row) => row.id)).toEqual([4, 5, 6]);
  });
});

describe('dialogScenePayload', () => {
  it('emits neighbor roles and variant labels', () => {
    const payload = dialogScenePayload({
      questEdid: 'MQ102',
      sceneEdid: 'SceneA',
      timingSensitive: true,
      turns: [
        turn(1, 'Hi', { variantIndex: 1, variantCount: 2 }),
        turn(2, 'Later', { translate: false }),
      ],
    });
    expect(payload).toEqual({
      quest: 'MQ102',
      scene: 'SceneA',
      timing_sensitive: true,
      turns: [
        {
          id: 1,
          kind: 'response',
          speaker: 'Preston',
          source: 'Hi',
          variant: '1/2',
          role: 'translate',
        },
        {
          id: 2,
          kind: 'response',
          speaker: 'Preston',
          source: 'Later',
          role: 'neighbor',
        },
      ],
    });
  });
});

describe('chunkFo4DialogFamily', () => {
  it('groups by scene and keeps RNAM before NAM1', () => {
    const groups = new Map<number, Fo4DialogGroupRow>([
      [
        10,
        {
          string_id: 10,
          scene_id: 7,
          scene_edid: 'SceneA',
          topic_id: 1,
          quest_edid: 'MQ102',
          timing_sensitive: false,
          phase_order: 2,
          prompt_first: 1,
          speaker_name: 'Nick',
        },
      ],
      [
        11,
        {
          string_id: 11,
          scene_id: 7,
          scene_edid: 'SceneA',
          topic_id: 1,
          quest_edid: 'MQ102',
          timing_sensitive: false,
          phase_order: 2,
          prompt_first: 0,
          speaker_name: 'Player',
        },
      ],
    ]);
    const chunks = chunkFo4DialogFamily(
      [
        { stringId: 10, sourceText: 'Reply', field: 'NAM1', llmItem: { source: 'Reply' } },
        { stringId: 11, sourceText: 'Ready?', field: 'RNAM', llmItem: { source: 'Ready?' } },
      ],
      groups,
      { maxTargets: 10, singleRowMaxSourceChars: 500 },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.items.map((item) => item.stringId)).toEqual([11, 10]);
    expect(chunks[0]!.scene.turns.map((row) => row.id)).toEqual([11, 10]);
    expect(chunks[0]!.scene.turns[0]).toMatchObject({ kind: 'prompt', speaker: 'Player' });
  });
});
