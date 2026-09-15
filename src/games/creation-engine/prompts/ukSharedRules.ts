/**
 * Boilerplate shared verbatim — or with one small per-game parameter — across
 * the six non-FO4 Ukrainian translate/verify prompts (fo3, fnv, ob, mw, sse,
 * fo76). Verified empirically (diffed section by section) before extraction;
 * see the commit history for the exact per-game exceptions below.
 *
 * FO4 has its own kernel + families split (`fo4/kernel.ts`) and does not use
 * this module. A game plugs in by importing what it needs from here into its
 * own `translate.ts` / `verify.ts` — there is no central switch on game id.
 */

/** Translate §1 — technical JSON format. Byte-identical across all six games. */
export const UK_TRANSLATE_FORMAT_RULES = `### 1. ТЕХНІЧНИЙ ФОРМАТ ТА СУВОРІ ОБМЕЖЕННЯ (КРИТИЧНО)
- **Вхід**: JSON-об'єкт із метаданими та масивом "items".
- **Вихід**: ЛИШЕ валідний, чистий JSON. Заборонено markdown-обгортки (\`\`\`json ... \`\`\`), вступні чи підсумкові слова.
- **Структура виходу**: Кожен елемент масиву "items" містить **ВИКЛЮЧНО** поля "id" та "parts".
- **ЗАБОРОНЕНО**: залишати або додавати у вихід поля "source", "translation", "grup", "edid", "field", "form_id", "context", "slots" тощо.
- **Цілісність**: Кількість, порядок та значення "id" у вихідному масиві ТОЧНО збігаються з вхідними.
- **Перекладай лише** рядкові елементи "parts". Цілі числа — слоти; скопіюй кожен індекс рівно стільки разів, скільки він є у вході.
- **Формат відповіді**: {"items":[{"id":<number>,"parts":["текст",0," ще"]}, ...]}`;

/**
 * Translate §4 — RAG/glossary/metadata mechanics. Identical across all six
 * games except the one worked example in "Серії та шаблони", which each game
 * picks to match its own item naming (e.g. "Layer Handle", "Lesser Soul Gem").
 * Skyrim additionally inserts its MCM UI rules before "Омоніми" — pass those
 * via `extraBeforeHomonyms`.
 */
export const buildUkTranslateMetadataRules = (
  seriesExample: string,
  opts?: { extraBeforeHomonyms?: string },
): string =>
  `### 4. УЗГОДЖЕНІСТЬ, ТЕРМІНОЛОГІЯ ТА МЕТАДАНІ
- **Короткі мітки рідкості (КРИТИЧНО)**: source лише Epic/Legendary/Rare/Unique/Common → переклад **одним словом** («Епічна», «Легендарна»). НЕ розширюй з edid, reference_examples чи \`context\`.
- **Серії та шаблони**: однаковий шаблон, різні лише числа ("${seriesExample} - 0" … "- 13") → **ідентичний** шаблон перекладу в межах batch; не міняй синоніми між сусідніми id.
- **Glossary**: поле "glossary" у запиті — **АВТОРИТЕТНЕ**; інтегруй терміни без зміни базової назви (відмінюй за потреби).
- **Style guide**: поле "style_guide" у запиті — додаткові інструкції користувача щодо стилю й тону; дотримуйся їх, якщо вони не суперечать технічним правилам (§1–2) та glossary.
- **Reference Examples (RAG)**: підказки, не наказ — RAG може повернути нерелевантні приклади (fuzzy/embedding). Ігноруй, якщо source прикладу не збігається або суперечить поточному source/grup/field. Шаблон серії бери лише з exact/numeric з тим самим source-шаблоном; не копіюй переклад цілком. reference_examples НЕ додають слів, яких немає в source.
- **Метадані** (grup, field, edid, form_id, context): ХТО говорить, КОМУ, ДЕ текст. Не копіюй у переклад і не розширюй короткий source словами з edid.
${opts?.extraBeforeHomonyms ? `${opts.extraBeforeHomonyms}\n` : ''}- **Омоніми**: те саме англійське слово може мати різні відповідники залежно від grup/field.
- Числові значення не конвертуй, якщо source цього не вимагає.`;

/**
 * Verify §1 — JSON format + verdict criteria. Identical across five of six
 * games; Morrowind appends one clause to the suggestion-format bullet
 * (`%s` indices matter more there — see `mw/verify.ts`).
 */
export const buildUkVerifyFormatRules = (opts?: { extraSuggestionNote?: string }): string =>
  `### 1. ТЕХНІЧНИЙ ФОРМАТ ТА VERDICT (КРИТИЧНО)
- **Вхід**: JSON з метаданими та масивом "items" (поля id, parts, translation_parts, slots, grup, field, edid, context, speaker, speaker_gender, addressee, addressee_gender, glossary, reference_examples тощо).
- **Вихід**: ЛИШЕ валідний, чистий JSON. Заборонено markdown-обгортки (\`\`\`json ... \`\`\`), вступні чи підсумкові слова.
- Для кожного вхідного "id" у вихідному JSON ПОВИНЕН бути відповідний об'єкт.

**Критерії verdict:**
1. **"ok"**: Переклад точний, природний, стиль витримано, термінологія правильна, слоти збережені. Поле "suggestion" — **null**.
2. **"suspicious"**: Конкретна виправна проблема (калька, русизм, втрата змісту, помилковий термін, порушення звертання/гендеру, розбіжність шаблону серії). НЕ для дрібних стилістичних уподобань. Якщо переклад прийнятний — "ok". Інакше — кращий варіант у "suggestion".
3. **"incorrect"**: Груба помилка: збій пари source↔translation (TM), неправильний зміст, омонім, русизм, зламані токени, неперекладений source, текст без сенсу. НЕ став "incorrect" лише через порядок слів у назві предмета/mod-модифікації, якщо зміст збережено.

**Правила suggestion (КРИТИЧНО):**
- Source/translation приходять як "parts" / "translation_parts" і опційно "slots" (лише kind). Suggestion — той самий масив parts (або null). Не пиши сирі теги в рядках.${
    opts?.extraSuggestionNote ? ` ${opts.extraSuggestionNote}` : ''
  }
- Не переписуй прийнятний переклад «на всяк випадок». Якщо проблеми немає — verdict "ok", suggestion null.
- Якщо suggestion збігається з translation_parts — verdict ОБОВ'ЯЗКОВО "ok", suggestion null.
- Не вигадуй «русизми»: «повіка», «шкода», «ствол» — коректна українська. Якщо не впевнений — verdict "ok".
- У suggestion змінюй ЛИШЕ конкретну проблему з reason; не переписуй увесь рядок без потреби (лише для "suspicious").
- Для verdict **"incorrect"** поле "suggestion" — ПОВНИЙ переклад source наново (масив parts). Хибний translation ігноруй повністю, не патч його. Null лише для багаторядкового source — тоді система перекладе заново.
- НІКОЛИ не вставляй у "suggestion" JSON-об'єкт verify (id, verdict, reason, confidence). Лише масив parts або null.
- НІКОЛИ не скорочуй suggestion через "..." — або повний виправлений parts, або null.
- Для багаторядкового source (кілька абзаців/рядків) suggestion має бути **null**; опиши проблему в reason, система перекладе заново.

**Поля відповіді:**
- "reason": коротке конкретне пояснення українською (не «Гарний переклад», а ЧОМУ ok або ЩО не так).
- "confidence": впевненість 0.0–1.0.
- "suggestion": null для "ok" і для багаторядкового source; для "suspicious" — ПОВНИЙ виправлений parts з того самого source (не з reference_examples, якщо їхній source інший); для "incorrect" — ПОВНИЙ переклад source наново. Якщо не впевнений — null і verdict "ok".

**Формат відповіді:**
{"items":[{"id":1,"verdict":"ok","reason":"…","confidence":1.0,"suggestion":null},{"id":2,"verdict":"incorrect","reason":"…","confidence":0.95,"suggestion":["переклад source наново"]}]}`;

/** Default placeholder-syntax examples cited by verify §3 (translate §2 mirrors this list too). */
const UK_VERIFY_DEFAULT_PLACEHOLDER_EXAMPLES = '%s, %d, {0}, $PlayerName, <Alias=Player>, [Mod]';

/**
 * Verify §3 — slot/tag preservation. Identical across five of six games;
 * Morrowind has no `<Alias=…>`/`$PlayerName` placeholder syntax in its engine,
 * so it cites a shorter list and adds one emphasis note.
 */
export const buildUkVerifySlotRules = (opts?: {
  extraMultisetNote?: string;
  placeholderExamples?: string;
}): string =>
  `### 3. ЗБЕРЕЖЕННЯ СЛОТІВ І ТЕГІВ (КРИТИЧНО)
- Мультимножина індексів у translation_parts і suggestion = як у parts.${
    opts?.extraMultisetNote ? ` ${opts.extraMultisetNote}` : ''
  }
- Не пиши сирі %s / <Alias=…> / ¤PH0¤ у рядках. Пайплайн підставить ${
    opts?.placeholderExamples ?? UK_VERIFY_DEFAULT_PLACEHOLDER_EXAMPLES
  } тощо.
- [Sarcasm], [Whispering] — перекладені ([Сарказм], [Шепіт]); [Mod], [Key], [Note], [Scrap] — слоти.
- **ПОМИЛКА → "incorrect"**: пропущений/вигаданий індекс, сирий тег у рядку, %s→%d.`;

/**
 * Verify §5 — consistency/terminology/metadata audit. Same 8-bullet skeleton
 * across all six games; only the worked examples in the first three bullets
 * differ per game (rarity words, series mismatch pair, glossary synonym trap).
 * Skyrim additionally inserts its MCM UI verify rules before "Омоніми" — pass
 * those via `extraBeforeHomonyms`.
 */
export const buildUkVerifyMetadataRules = (opts: {
  extraRarityWord?: string;
  seriesSuspiciousExample?: string;
  glossaryExample: string;
  extraBeforeHomonyms?: string;
}): string =>
  `### 5. УЗГОДЖЕНІСТЬ, ТЕРМІНОЛОГІЯ ТА МЕТАДАНІ
- **Короткі мітки рідкості (КРИТИЧНО)**: source лише Epic/Legendary/Rare/Unique/Common → translation **одним словом** («Епічна», «Легендарна»${
    opts.extraRarityWord ? `, «${opts.extraRarityWord}»` : ''
  }). Розширення з edid або reference_examples → **"incorrect"**. Довгий source + лише рідкість у translation → **"incorrect"**.
- **Серії та шаблони**: однаковий source-шаблон, різні лише числа → **ідентичний** шаблон перекладу в batch. Різні ключові слова в серії${
    opts.seriesSuspiciousExample ? ` (${opts.seriesSuspiciousExample})` : ''
  } → "suspicious". Шаблон серії застосовуй ЛИШЕ коли translation уже відповідає тому самому source; інакше mismatch → "incorrect".
- **Glossary**: поле "glossary" — **АВТОРИТЕТНЕ**; term має з'являтися в source. Синонім замість канону → "suspicious" (напр. ${opts.glossaryExample}).
- **Reference Examples (RAG)**: RAG може повернути сміття (fuzzy/embedding) — ігноруй суперечливі або з іншим source/grup/field. Шаблон серії — лише від exact/numeric з тим самим source-шаблоном. Не копіюй suggestion з чужого прикладу.
- **Метадані** (grup, field, edid, context): контекст типу рядка; не копіюй edid у переклад.
${opts.extraBeforeHomonyms ? `${opts.extraBeforeHomonyms}\n` : ''}- **Омоніми**: те саме англійське слово — різні відповідники за grup/field.
- Числові значення не конвертуй, якщо source цього не вимагає.
- Два варіанти з однаковим змістом (стислий vs розлогий) — verdict "ok"; не пропонуй перефраз лише за стилем.`;
