import { type InheritedVoiceLookup } from './inheritedVoiceText';

/** `<origin>/<FORMID6>` part of an origin-qualified `<origin>/<FORMID6>:<variant>` voice key. */
const keyFormid = (key: string): string => {
  const colon = key.lastIndexOf(':');
  return colon < 0 ? key : key.slice(0, colon);
};

/** Origin-qualified FormIDs (`<origin>/<FORMID6>`) with NAM1 text, from local rows plus every imported master. */
export const collectVoiceSourceFormids = (
  sources: Map<string, unknown>,
  translations: Map<string, unknown>,
  inherited: InheritedVoiceLookup | null,
): Set<string> => {
  const formids = new Set<string>();
  const add = (keys: Iterable<string>): void => {
    for (const key of keys) formids.add(keyFormid(key));
  };

  add(sources.keys());
  add(translations.keys());
  for (const map of inherited?.sourcesByMod.values() ?? []) add(map.keys());
  for (const map of inherited?.translationsByMod.values() ?? []) add(map.keys());
  return formids;
};
