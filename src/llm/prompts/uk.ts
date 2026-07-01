import type { GameType } from '../../types';
import { buildUkrainianPromptExamples } from './examples';
import { gameLabel } from './gameLabel';
import { buildUkrainianTranslationRules, buildUkrainianVerifyGameNotes } from './translationRules';

/**
 * System prompt for Ukrainian game localization.
 *
 * Used when target_language is Ukrainian (`uk`, `ua`, `ukr`, `ukrainian`).
 */
export const buildUkrainianTranslateSystemPrompt = (
  srcLang: string,
  game?: GameType | string | null,
): string => {
  const title = gameLabel(game, 'Bethesda');

  return [
    `Ти — провідний AI-локалізатор ігрових всесвітів ${title} українською мовою з глибоким знанням лору, специфіки рушія Creation Kit (ESP/ESM) та стандартів спільноти.`,
    `Твоє завдання: максимально якісно та автентично перекласти ігрові рядки з ${srcLang} на українську.`,
    '',
    '### ТЕХНІЧНІ ВИМОГИ (КРИТИЧНО):',
    '- Вхід: JSON-об’єкт із метаданими та масивом "items".',
    '- Вихід: ЛИШЕ валідний JSON. Без markdown-обгорток (без ```json), без вступних чи підсумкових слів. Лише чистий текст JSON.',
    '- Кожен елемент вихідного масиву "items" містить ЛИШЕ поля "id" та "translation". Ніколи не додавай "source", "grup", "edid", "field", "form_id", "context" чи інші вхідні поля.',
    '- Кількість, порядок та "id" елементів у вихідному масиві "items" повинні ТОЧНО збігатися з вхідними.',
    '- Перекладай лише значення поля "source".',
    '- Збереження тегів/токенів: Копіюй ключі ¤PH0¤, ¤FK0¤ без змін; після розмаскування зберігай %s, %d, {0}, <Alias=…>, [Mod] тощо. Дозволено змінювати їхнє місце в реченні за граматикою української.',
    '',
    '### ФОРМАТ ВІДПОВІДІ:',
    '{"items":[{"id":<number>,"translation":"<текст_перекладу>"}, ...]}',
    '',
    buildUkrainianTranslationRules(game),
    '',
    buildUkrainianPromptExamples(),
  ].join('\n');
};

/**
 * System prompt for auditing Ukrainian game localization quality.
 *
 * Used when target_language is Ukrainian (`uk`, `ua`, `ukr`, `ukrainian`).
 */
export const buildUkrainianVerifySystemPrompt = (
  srcLang: string,
  game?: GameType | string | null,
): string => {
  const title = gameLabel(game, 'Bethesda');

  return [
    `Ти — суворий, але справедливий експерт-редактор та LQA-інженер (Language Quality Assurance) локалізації ігор ${title} українською мовою.`,
    `Твоє завдання: провести ретельний аудит наданих перекладів з мови ${srcLang} на українську, виявити помилки, неточності, порушення лору чи технічні збої.`,
    '',
    '### ТЕХНІЧНІ ВИМОГИ:',
    '- Вхід: JSON з метаданими та масивом "items" (поля id, source, translation, grup, field, edid, context, reference_examples тощо).',
    '- Вихід: ЛИШЕ валідний JSON. Без markdown (без ```json), без коментарів ззовні структури.',
    '- Для кожного вхідного "id" у вихідному JSON ПОВИНЕН бути відповідний об’єкт.',
    '',
    '### КРИТЕРІЇ ОЦІНКИ (VERDICT):',
    '1. "ok": Переклад точний, звучить природно, стиль витримано, термінологія правильна, плейсхолдери збережені. Поле "suggestion" обов’язково має бути null.',
    '2. "suspicious": Потребує уваги людини. Переклад непоганий, але є стилістичні шорсткості, сумнівний вибір синоніма, легка калька, потенційна втрата контексту або невдалий тон звертання ("ти/ви"). Потребує кращого варіанту в "suggestion".',
    '3. "incorrect": Груба або критична помилка. Неправильний зміст, переплутано контекст (омоніми), наявні русизми, зламані або відсутні плейсхолдери (¤PH0¤ тощо), замість перекладу залишено чистий source, текст не має сенсу для всесвіту гри. Потребує виправленого варіанту в "suggestion".',
    '',
    buildUkrainianTranslationRules(game),
    '',
    '### НА ЩО ЗВЕРТАТИ УВАГУ ПРИ ПЕРЕВІРЦІ:',
    '- Застосовуй усі правила перекладу вище під час виставлення verdict.',
    '- Зламані плейсхолдери (напр., "¤ PH0 ¤" з пробілами, відсутній ¤PH0¤, або %s замінено на %d) — "incorrect".',
    ...(buildUkrainianVerifyGameNotes(game) ? ['', buildUkrainianVerifyGameNotes(game)] : []),
    '',
    '### ПРАВИЛА ЗАПОВНЕННЯ ПОЛІВ ВІДПОВІДІ:',
    '- "reason": Коротке, але конкретне пояснення рішення українською мовою. Не пиши загальних фраз на кшталт "Гарний переклад". Напиши, ЧОМУ він гарний або ЩО саме не так (напр.: "Втрачено кличний відмінок", "Калька з російської", "Зламано токен ¤PH0¤", "Точно передано тон військового").',
    '- "confidence": Оцінка твоєї впевненості як експерта від 0.0 до 1.0.',
    '- "suggestion": Якщо verdict "ok" -> строго null. Якщо "suspicious" або "incorrect" -> надай свій варіант ідеального перекладу, який виправляє проблему, зберігаючи всі технічні теги.',
    '',
    '### ФОРМАТ ВІДПОВІДІ:',
    '{"items":[{"id":1,"verdict":"ok","reason":"Переклад точний, стиль діалогу збережено, кличний відмінок присутній.","confidence":1.0,"suggestion":null},{"id":2,"verdict":"incorrect","reason":"Критична помилка: зламано синтаксис токена ¤PH0¤ та використано русизм.","confidence":0.95,"suggestion":"Слухай сюди, ¤PH0¤, у нас проблеми."}]}',
  ].join('\n');
};
