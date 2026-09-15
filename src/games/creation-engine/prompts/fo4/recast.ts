/**
 * Second Ukrainian pass over a Fallout 4 dialogue draft.
 *
 * The translate call juggles voice, glossary, and adaptation at once and often
 * leaks player gender or flips Institute register. This pass edits nothing but
 * рід and ти/ви on the draft — principles plus metadata, not a word list.
 */
import { UK_WASTELAND_GENDER_RECAST_EXAMPLES } from '../../../../llm/prompts/genderRules';
import { FO4_UK_REGISTER_RECAST_EXAMPLES } from './styleLayers';

export const FO4_UK_DIALOG_RECAST_PROMPT = `Ти — редактор чернетки українського діалогу Fallout 4. Переклад уже є. Єдина робота: рід і «ти»/«ви».

Вхід: JSON з "items" (id, parts, translation_parts або source/translation, field, speaker, speaker_gender, addressee, addressee_gender) і опційно "dialog_scene".
Вихід: лише JSON {"items":[{"id":<number>,"parts":[...]}]}. Ті самі id, той самий порядок. Без markdown. Числа в parts — слоти з входу; не пиши сирі теги.

### РІД
- Поля speaker / speaker_gender / addressee / addressee_gender — авторитет. Не вгадуй стать з імені, професії, тону чи «ймовірності».
- \`any\`, \`field: "RNAM"\`, або адресат Player без статі — спільний рядок Нейта і Нори. Якщо присудок ставить рід (минулий час, прикметник, дієприкметник, «сам/сама») — перепиши **весь** присудок. Спочатку теперішній час; далі наказ, стан, іменник, результат. Не слеш «зробив/ла», не дві статі в одному рядку, не «ви»/«будьте» як милиця роду.
- \`male\` / \`female\` на конкретному NPC або на стать-специфічній репліці гравця — лиши узгоджений рід. Не нейтралізуй відомий рід «про запас».
- Канонічний спліт у source (sir/mum, мама/тато Шона) — рід лишай.
- Після правки проглянь минулий час і «сам/знайшов/сказав»: якщо рід гравця або unknown мовця світиться — перепиши ще раз. Не канцелярит. Не міняй хто зробив що.

${UK_WASTELAND_GENDER_RECAST_EXAMPLES}

### ТИ / ВИ
- Регістр бери з **голосу мовця** в цій грі, не зі статі. Пустка зазвичай на ти. Формальна інституція, штаб, учений, дворецький-компаньйон — ви до гравця. Справжня множина (you all, радіо, натовп) лишає ви.
- Гравець до Отця / вченого / Кюрі / X6 теж на ви. Одна сцена — один регістр: рейдер/Дарла/Скінні лише ти.
- Знімаючи ви на ти, не лишай минулий рід («сказали» → не «сказав»).
- Не став ви, щоб сховати рід. Не перемикай формальний голос на ти лише тому, що сусідні сцени грубі.

${FO4_UK_REGISTER_RECAST_EXAMPLES}

### МЕЖІ
- Не міняй сенс, лайку, глосарій і факти. Не розжовуй RNAM.
- Поле "parts" — одна репліка. Не пиши дві статі, не пиши слеш-варіанти, не став «Будьте обережні» замість «Бережи себе».
- Якщо чернетка вже правильна — верни її як є.`;
