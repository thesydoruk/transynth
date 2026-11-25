/**
 * What every Starfield Ukrainian prompt starts with: the JSON contract, slots,
 * language and canon. A family prompt adds its own sections from §5 (translate)
 * or §6 (verify) on.
 *
 * The format, slot and metadata sections are the ones the single-prompt games
 * share (`../ukSharedRules`), so a fix there reaches Starfield too.
 */
import {
  UK_TRANSLATE_FORMAT_RULES,
  buildUkTranslateMetadataRules,
  buildUkVerifyFormatRules,
  buildUkVerifyMetadataRules,
  buildUkVerifySlotRules,
} from '../ukSharedRules';
import { SF1_UK_CANON_TRAPS } from './layers';

const SF1_UK_LANGUAGE = `- Жива сучасна українська (правопис 2019) без русизмів, кальок і дієприкметників на -учий/-ючий.
- Типографіка: лапки лише ASCII "…", апостроф ', тире — (і замість --), три крапки як у source; #1 → № 1; століття й порядкові — арабськими цифрами ("22 століття").
- Капіталізація як у source, КАПС — лише якщо весь source КАПСОМ; у заголовку з великої — перше слово й власні назви ("Дошка завдань").
- Звертання — кличним відмінком ("Саро", "капітане"). Звання й посади в реченні — з малої ("командер Іканде"); жінкам — фемінітиви посад (докторка, президентка), але військові звання чоловічою формою ("лейтенант Тофт наказала").
- Назву без канону транслітеруй (h → г, w → в, th → т, без ґ); прізвисько й назву корабля зі змістом перекладай (Two-Shot → Двостріл, "Frontier" → "Фронтир"). Моделі й абревіатури з цифрами (AA-99, Mk II, O2), одиниці й числа не чіпай.
- Назва закладу, корабля чи бренду: у реченні — в лапках, якщо без них неясно, де назва; у назві запису — без лапок.`;

export const SF1_UK_TRANSLATE_KERNEL = `${UK_TRANSLATE_FORMAT_RULES}

### 2. СЛОТИ Й ТЕГИ (КРИТИЧНО)
- "slots" називає kind кожного індексу (alias, printf, var, tag, break, markup, keyword): пайплайн сам підставить \`%s\`, \`{0}\`, \`<Alias=…>\`, \`<Global=…>\`, \`<mag>\`, \`<font>\`, \`$…\` і переноси рядків. Сирих тегів у рядках не пиши, індексів не пропускай і не вигадуй.
- Порядок індексів можна змінити за граматикою. Відмінок слота не зміниш — будуй речення так, щоб він стояв у називному (["Місце: ", 0]).

### 3. МОВА Й КАНОН
${SF1_UK_LANGUAGE}
- Порожній source не перекладай.
${SF1_UK_CANON_TRAPS}

${buildUkTranslateMetadataRules('Ship Module')}`;

export const SF1_UK_VERIFY_KERNEL = `${buildUkVerifyFormatRules()}

### 2. ЗБІЙ ПАРИ SOURCE ↔ TRANSLATION (ПРІОРИТЕТ #1)
- Спершу перевір, чи translation передає source ЦЬОГО id. Текст іншого рядка (збій TM, edid-колізія), інша сутність, лише рідкість замість назви чи навпаки → **"incorrect"**.
- Ієрархія: source → glossary → правила гри → сусіди в batch → reference_examples. edid не додає слів у переклад.

${buildUkVerifySlotRules()}

### 4. МОВА Й КАНОН
${SF1_UK_LANGUAGE}
- Порушення цих правил — **"suspicious"** з виправленням у suggestion; залишок англійської (крім моделей, абревіатур і SSNN) — **"incorrect"**.
${SF1_UK_CANON_TRAPS}
- Лексика Fallout чи The Elder Scrolls, якої немає в source, → **"incorrect"**; транслітерація замість канону (Констеляція, Старборн, спейсери) → **"suspicious"**.

${buildUkVerifyMetadataRules({ glossaryExample: '"Констеляція" для Constellation' })}`;
