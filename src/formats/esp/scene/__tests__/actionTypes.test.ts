import type { SceneAction } from '../../../types';
import { isTimingSensitiveAction, sceneHasTimingConstraint } from '../actionTypes';

const action = (overrides: Partial<SceneAction>): SceneAction => ({
  actionType: 'dialogue',
  aliasId: 1,
  topicFormId: '00000D01',
  topicFormIds: ['00000D01'],
  startPhase: 0,
  endPhase: 0,
  timerMinSeconds: null,
  timerMaxSeconds: null,
  loopMin: null,
  loopMax: null,
  flags: 0,
  startSceneFormId: null,
  ...overrides,
});

describe('scene timing helpers', () => {
  it('treats linear dialogue as safe and timers/packages as constrained', () => {
    expect(isTimingSensitiveAction(action({}))).toBe(false);
    expect(isTimingSensitiveAction(action({ actionType: 'player_dialogue' }))).toBe(false);
    expect(
      isTimingSensitiveAction(action({ actionType: 'timer', topicFormId: null, topicFormIds: [] })),
    ).toBe(true);
    expect(
      isTimingSensitiveAction(
        action({ actionType: 'package', topicFormId: null, topicFormIds: [] }),
      ),
    ).toBe(true);
    expect(isTimingSensitiveAction(action({ flags: 0x00010000 }))).toBe(true);
    expect(isTimingSensitiveAction(action({ loopMax: 4 }))).toBe(true);
    expect(
      sceneHasTimingConstraint([
        action({}),
        action({ actionType: 'start_scene', startSceneFormId: '00000EEE' }),
      ]),
    ).toBe(true);
  });
});
