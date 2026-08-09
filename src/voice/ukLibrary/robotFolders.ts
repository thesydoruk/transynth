/**
 * Heuristic for bulk mapping proposals only.
 * Robots may still receive a global Ukrainian library link via the UI / API;
 * this helper just excludes them from the initial hand-built mapping set.
 */
const ROBOT_FOLDER_RE =
  /(?:^|[^A-Za-z])(?:Robot|Assaultron|Protectron|SentryBot|Eyebot|LibertyPrime|MrHandy|MrGutsy|MsNanny|Nukatron|Robobrain|Nira|MechanistEyebot)(?:[^A-Za-z]|$)/i;

/** True for FO4 robot / automaton voice folders (not human-sounding synth companions). */
export const isRobotVoiceFolder = (characterKey: string): boolean => {
  const key = characterKey.trim();
  if (!key) return false;
  if (/^Robot/i.test(key)) return true;
  if (/Robot/i.test(key)) return true;
  if (ROBOT_FOLDER_RE.test(key)) return true;
  if (/^DLC0\dRobot/i.test(key)) return true;
  return false;
};
