/**
 * Status badge palette for chips and progress segments.
 *
 * The map resolves to global CSS custom properties from `index.scss` so theme
 * switching (dark/light) automatically updates colours without touching logic.
 *
 * EET4 semantic mapping:
 * - reviewed/human -> _99_Valide
 * - draft          -> _20_ModCharge
 * - tm             -> _50_TradAuto
 * - auto           -> _70_Internet
 * - fuzzy          -> _80_SansPonctuation
 * - rejected       -> _90_Devalide
 */
export const STATUS_COLORS: Record<string, string> = {
  reviewed:     'var(--status-reviewed)',     // green  — confirmed
  human:        'var(--status-human)',        // green  — human-confirmed
  draft:        'var(--status-draft)',        // lime   — unconfirmed (EET4 YellowGreen)
  rejected:     'var(--status-rejected)',     // dark-red
  tm:           'var(--status-tm)',           // blue   — translation memory
  fuzzy:        'var(--status-fuzzy)',        // cyan   — fuzzy match
  auto:         'var(--status-auto)',         // orange — AI/LLM translation
  untranslated: 'var(--status-untranslated)',
};