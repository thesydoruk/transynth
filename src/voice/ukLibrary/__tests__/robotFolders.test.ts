import { isRobotVoiceFolder } from '../robotFolders';

describe('isRobotVoiceFolder', () => {
  it('flags mechanical robot folders', () => {
    expect(isRobotVoiceFolder('RobotMrHandy')).toBe(true);
    expect(isRobotVoiceFolder('RobotProtectron')).toBe(true);
    expect(isRobotVoiceFolder('DLC01RobotCompanionFemaleDefault')).toBe(true);
    expect(isRobotVoiceFolder('DLC01RobotCompanionBleepA')).toBe(true);
    expect(isRobotVoiceFolder('RobotAssaultron')).toBe(true);
  });

  it('keeps human and synth companions out of the bulk-proposal skip list', () => {
    expect(isRobotVoiceFolder('NPCFCurie')).toBe(false);
    expect(isRobotVoiceFolder('NPCFPiper')).toBe(false);
    expect(isRobotVoiceFolder('NPCMNickValentine')).toBe(false);
    expect(isRobotVoiceFolder('SynthGen3Female01')).toBe(false);
    expect(isRobotVoiceFolder('MaleEvenToned')).toBe(false);
  });
});
