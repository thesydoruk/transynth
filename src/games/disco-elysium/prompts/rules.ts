import { DISCO_UK_GLOSSARY } from './glossary';
import {
  formatCanonicalEnLines,
  formatCanonicalUkLines,
} from '../../../llm/prompts/translationRules/canonical';
import type { GameRules } from '../../../llm/prompts/translationRules/types';

const discoPlaceholdersEn = [
  '### PLACEHOLDER AND TAG PRESERVATION (Disco / gettext):',
  '- Disco lockit arrives as parts + integer slots. Paired markup uses the same index twice (italics, quotes, singles).',
  '- Never write raw {0}, %s, *, ", --, or ¤IT0¤ / ¤Q0¤ / ¤EM0¤ inside a string part.',
  '- Slot kinds: var/printf for Unity tokens; markup for lockit italics/quotes/em-dash/singles.',
  '- Lockit markup (translate only the inner words):',
  '  - Quotes: parts [0, "name", 0] (slot raw `"`). Do not add extra `"…"` around names.',
  '  - Italics: parts [0, "word", 0] (slot raw `*`, unmasks to `*word*`). Not Fallout `*sigh*`.',
  '  - Em-dash: a single markup slot (raw `--`). Punctuation, not `--emphasis--`.',
  '  - Singles: parts [0, "fun stuff", 0] (slot raw `\'`). Do not turn them into inner `"..."`.',
  '  - UI `[Leave.]` / `[Discard thought.]` — keep brackets; translate the label.',
  '- Effect brackets [1] or [Thought Name]: keep structure; translate the name inside; do not change numbers.',
  '- Preserve a leading space when the source effect line has one.',
  '- Reorder tokens only when target-language grammar requires it.',
];

const discoStyleEn = [
  '### STYLE, TONE, AND ATMOSPHERE (Disco Elysium):',
  '- Martinaise, Revachol: political noir, surreal skill-voices, tragicomedy. Not a Bethesda RPG; not Creation Kit / ESP.',
  '- Metadata: grup is typically PO; field/edid is msgctxt (Dialogue Text/…, Alternate1/…, *_EFFECT) or actor name (You, Kim, Volition).',
  '- Harry Du Bois ("You") is always male. Skills and most NPCs address him informally (T-V: informal "you" in languages that distinguish it). Formal "you" only for Joyce, Evrart, Moralintern, officials.',
  '- Do NOT apply Fallout "always V-form to the player" or "player gender is any".',
  '- 24 skills are distinct characters: Inland Empire mystic; Electrochemistry hedonist; Encyclopedia pedant; Drama theatrical; Shivers the city speaking; Half Light paranoid; Volition backbone; Authority cop-command; Suggestion silky manipulation (not "proposal"); Physical Instrument bro/meat; Visual Calculus forensic geometry; Esprit/Espirit de Corps RCM radio; Interfacing machines (not UI "interface").',
  '- Cuno: filthy street slang — do not sanitize. Do not neutralize political satire.',
  '- Restored lockit slurs (do not invent synonyms): faggot → підар (vocative підаре); faggots → підари; faggoted → підарськи; Pissfaggot → сцикуняка; PISSFAGGOT → СЦИКУНЯКА (jacket tag, one word). Not «педик» / «Пісспідар» / re-censored stars.',
  '- Effects lockit: "Heal Volition [1]", "Damage Endurance [1]", "Gain Thought [X]", "Reputation Grows [X]" — keep the formula.',
  '- Passive checks: "{0} difficulty to all {1} passives"; difficulty adjectives stay a consistent set.',
  '- UI (General lockit): compact labels, not prose.',
];

const discoStyleUk = [
  '### СТИЛЬ, ТОН ТА АТМОСФЕРА (Disco Elysium):',
  '- Мартінез, Ревашоль: політичний нуар, голоси навичок, трагікомедія. Не Fallout і не Creation Kit.',
  '- Гаррі («You») завжди чоловічого роду; навички звертаються на «ти».',
  '- Suggestion → Навіювання; Interfacing → Інтерфейсинг; The Pale → Блідь; RCM → РГМ.',
  '- faggot → підар; faggots → підари; faggoted → підарськи; Pissfaggot → сцикуняка; PISSFAGGOT → СЦИКУНЯКА.',
  '- Ефекти: «Зцілити Волю [1]», «Репутація зростає […]», «Отримати думку […]».',
];

export const discoRules: GameRules = {
  en: (targetLang) => [
    ...discoPlaceholdersEn,
    '',
    '### CAPITALIZATION:',
    '- Preserve the source capitalization pattern. ALL CAPS only when the entire source is ALL CAPS.',
    '',
    '### LINGUISTIC QUALITY:',
    `- Write fluent, idiomatic ${targetLang} that can carry ZA/UM register shifts (bureaucracy, slang, poetry, philosophy).`,
    '- Avoid calques. Keep dialogue speakable; keep UI compact.',
    '',
    ...discoStyleEn,
    '',
    ...formatCanonicalEnLines('DISCO ELYSIUM', DISCO_UK_GLOSSARY, targetLang),
    '### TRANSLATION EXAMPLES (Disco Elysium):',
    '- Skill lines must remain recognizable as that skill, not generic NPC narration.',
    '- "Heal Volition [1]" keeps Heal + canonical Volition + [1].',
    '- RCM in running text follows community canon for the target language (Ukrainian: РГМ).',
  ],
  uk: () => [
    ...discoStyleUk,
    '',
    ...formatCanonicalUkLines('DISCO ELYSIUM', DISCO_UK_GLOSSARY),
    '### ПРИКЛАДИ (Disco Elysium):',
    '- Репліки навичок не зводь до «звичайного NPC».',
    '- «Heal Volition [1]» → «Зцілити Волю [1]».',
  ],
  verifyEn: () => [
    '### VERIFY — Disco Elysium:',
    '- Flattened skill voice (reads like a generic narrator) → "suspicious".',
    '- Harry/"You" in feminine grammatical gender → "incorrect".',
    '- Formal V-form from a skill to Harry where the language distinguishes T/V → "suspicious".',
    '- Transliteration instead of glossary canon (Volition, Inland Empire, The Pale, RCM) → "suspicious" or "incorrect".',
    '- Lost quotes / *italics* / `--` / [Leave.] relative to source → "incorrect" (quotes) or "suspicious" (other markup).',
    '- Source singles `\'fun stuff\'` rewritten as inner `"..."` → "incorrect".',
    '- Effect/passive formula broken (lost [1], lost {0}, "Heal" line translated as dialogue) → "incorrect" if pairing failed, else "suspicious".',
    '- Sanitized Cuno or neutralized political labels that the source states plainly → "suspicious".',
    '- This is a gettext .po pack, not a Bethesda plugin.',
  ],
  verifyUk: () => [
    '- Репліка навички як нейтральний NPC — "suspicious".',
    '- Жіночий рід для Гаррі (You) — "incorrect".',
    '- Трансліт замість канону (Воля, Блідь, РГМ, Навіювання) — "suspicious" або "incorrect".',
    '- Зламаний шаблон ефекту або пасивної перевірки — "suspicious" / "incorrect".',
    '- Втрачені лапки / *курсив* / `--` / [Leave.] проти source — "incorrect" (лапки) або "suspicious".',
    '- Одинарні `\'fun stuff\'` у source, а в translation внутрішні `"..."` — "incorrect".',
    '- faggot не як «підар» (педик, зірки, евфемізм) — "suspicious".',
  ],
};
