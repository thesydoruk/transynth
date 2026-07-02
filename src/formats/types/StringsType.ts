/**
 * Supported Bethesda string table formats.
 *
 * - `"STRINGS"`   — generic text (item names, descriptions, UI labels).
 * - `"DLSTRINGS"` — dialogue text shown in conversation menus.
 * - `"ILSTRINGS"` — internal info strings (topics, notes, etc.).
 */
export type StringsType = 'STRINGS' | 'DLSTRINGS' | 'ILSTRINGS';
