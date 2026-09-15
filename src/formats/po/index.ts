/**
 * gettext `.po` reading and writing.
 *
 * Format only: catalogue entries in, catalogue entries out. What the strings
 * inside mean, and how one game lays its catalogues out on disk, belongs to
 * that game's plugin.
 */
export { parsePoBuffer, poEntryKey, type PoEntry } from './parsePo';
export { writePoWithOverlays } from './writePo';
