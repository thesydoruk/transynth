import { ratio } from 'fuzzball';

// Returns 0..100 like RapidFuzz's ratio
export const fuzzyScore = (a: string, b: string): number => {
  return ratio(a ?? '', b ?? '');
}