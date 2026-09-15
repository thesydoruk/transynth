/**
 * The Ukrainian rule block every Bethesda prompt injects.
 *
 * Two things need saying in every Ukrainian prompt regardless of the game:
 * how to agree gender with the dialog metadata, and which English phrasings
 * must not survive the translation. Both are here so a game prompt inserts one
 * call and a new rule reaches all of them at once.
 */
import { promptCalqueRules } from '../../dialog';
import {
  buildUkGenderTranslateRules,
  buildUkGenderVerifyRules,
  type UkPlayerRegister,
} from './genderRules';

export type { UkPlayerRegister } from './genderRules';

const calqueList = (): string =>
  promptCalqueRules()
    .map((rule) => `  - "${rule.english}" → ${rule.instead}.`)
    .join('\n');

/**
 * Calques are grammatical, so nothing else in the pipeline objects to them.
 * The list is the same one the QA check enforces, spelled out so the model can
 * avoid them rather than be corrected afterwards.
 */
const UK_CALQUE_TRANSLATE = `- **Не калькуй англійську конструкцію.** Речення має звучати як написане українською, а не перекладене. Найчастіші:
${calqueList()}
- Ширше правило: англійський порядок слів, зайві присвійники («він поклав свою руку в свою кишеню»), «робити» замість дієслова дії, ланцюжки з «бути» — переписуй, а не перекладай слово в слово.`;

const UK_CALQUE_VERIFY = `- **Кальки з англійської** — граматично правильні, але видають переклад. Знайшов таку → **"suspicious"**; suggestion природною українською:
${calqueList()}
- Не став "suspicious" за живий розмовний зворот лише тому, що він короткий або грубий: калька — це коли українською так не кажуть, а англійською кажуть.`;

/** Ukrainian rules for a translation prompt. */
export const buildUkrainianTranslateRules = (
  playerLabel: string,
  register: UkPlayerRegister = 'formal-vy',
): string => `${buildUkGenderTranslateRules(playerLabel, register)}
${UK_CALQUE_TRANSLATE}`;

/** Ukrainian rules for a verification prompt. */
export const buildUkrainianVerifyRules = (
  playerLabel: string,
  register: UkPlayerRegister = 'formal-vy',
): string => `${buildUkGenderVerifyRules(playerLabel, register)}
${UK_CALQUE_VERIFY}`;
