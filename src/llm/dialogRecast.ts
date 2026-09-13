/**
 * Second LLM pass after FO4 UK dialog translate.
 *
 * The first call juggles voice, glossary, and adaptation and often leaks
 * player gender or flips Institute register. This pass only edits рід and
 * ти/ви on the draft — principles plus metadata, not a word list.
 */
import { chatWithFallback } from './index';
import { parseLlmItemId, parseLlmJson } from './jsonParse';
import { participantPayloadFields } from './dialogParticipants';
import { compactLlmItemFields } from './llmPayloadCompact';
import { dialogScenePayload, type DialogSceneContext } from './dialogScene';
import { logLlm } from '../logging/loggers';
import { resolveBatchPromptFamily, type LlmPromptFamily } from './promptFamily';
import { buildTranslateResponseFormat } from './responseSchemas';
import type { GameType } from '../types';
import { UK_WASTELAND_GENDER_RECAST_EXAMPLES } from './prompts/genderRules';
import { FO4_UK_REGISTER_RECAST_EXAMPLES } from './prompts/games/fo4/styleLayers';
import type { LlmTranslateOptions, LlmTranslateResult } from './translate';
import { alignTextToSlots, assembleTranslatedText, compactLlmPartsFields } from './textParts';

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

export const shouldRecastFo4UkDialog = (opts: {
  game?: GameType | string | null;
  targetLang: string;
  promptFamily?: LlmPromptFamily | null;
  items: Array<{ grup?: string | null; field?: string | null }>;
  skipDialogRecast?: boolean;
}): boolean => {
  if (opts.skipDialogRecast) return false;
  if (opts.targetLang !== 'uk') return false;
  const family = resolveBatchPromptFamily(opts.game, opts.items, opts.promptFamily);
  return opts.game === 'fo4' && family === 'dialog';
};

export const mergeDialogRecast = (
  draft: LlmTranslateResult[],
  recastById: Map<number, string>,
): LlmTranslateResult[] =>
  draft.map((row) => {
    const next = recastById.get(row.id);
    if (next == null || next.trim() === '') return row;
    return { id: row.id, translation: next };
  });

const parseRecastItems = (
  raw: string,
  requestItems: LlmTranslateOptions['items'],
): Map<number, string> => {
  const parsed = parseLlmJson(raw);
  const items = (parsed as { items?: unknown }).items;
  const byId = new Map<number, string>();
  if (!Array.isArray(items)) return byId;
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { id?: unknown; translation?: unknown; parts?: unknown };
    const id = parseLlmItemId(row.id);
    if (id == null) continue;
    const request = requestItems.find((item) => item.id === id);
    const assembled = assembleTranslatedText(
      row.parts,
      row.translation,
      request?.sourceParts,
      request?.restoreSlots,
    );
    if (assembled == null) continue;
    byId.set(id, assembled);
  }
  return byId;
};

const recastScene = (
  scene: DialogSceneContext | undefined,
  draftById: Map<number, string>,
): DialogSceneContext | undefined => {
  if (!scene) return undefined;
  return {
    ...scene,
    turns: scene.turns.map((turn) =>
      turn.id != null && draftById.has(turn.id)
        ? { ...turn, translation: draftById.get(turn.id) }
        : turn,
    ),
  };
};

export const buildDialogRecastUserPayload = (
  opts: LlmTranslateOptions,
  draft: LlmTranslateResult[],
): object => {
  const draftById = new Map(draft.map((row) => [row.id, row.translation]));
  const scene = recastScene(opts.dialogScene, draftById);
  return {
    task: 'dialog_gender_register_recast',
    source_language: opts.srcLang,
    target_language: opts.targetLang,
    game: opts.game ?? null,
    ...(scene ? { dialog_scene: dialogScenePayload(scene) } : {}),
    items: opts.items.map((item) => {
      const structured = compactLlmPartsFields(item.parts, item.slots);
      const draftText = draftById.get(item.id) ?? '';
      const translationParts =
        item.restoreSlots && item.restoreSlots.length > 0
          ? alignTextToSlots(draftText, item.restoreSlots)
          : [draftText];
      return {
        id: item.id,
        ...(structured.parts
          ? { ...structured, translation_parts: translationParts }
          : { source: item.source, translation: draftText }),
        ...compactLlmItemFields(item),
        ...participantPayloadFields(item),
      };
    }),
  };
};

/** Best-effort editor pass. On failure the first-pass draft is kept. */
export const recastFo4UkDialogTranslations = async (
  opts: LlmTranslateOptions,
  draft: LlmTranslateResult[],
): Promise<LlmTranslateResult[]> => {
  if (draft.length === 0 || !shouldRecastFo4UkDialog(opts)) return draft;

  const expectedIds = draft.map((row) => row.id);
  try {
    const { content, meta } = await chatWithFallback({
      model: opts.model,
      responseFormat: buildTranslateResponseFormat(expectedIds.length),
      signal: opts.signal,
      logMeta: {
        operation: 'dialog-recast',
        context: {
          itemIds: expectedIds,
          itemCount: expectedIds.length,
          game: opts.game ?? null,
        },
      },
      messages: [
        { role: 'system', content: FO4_UK_DIALOG_RECAST_PROMPT },
        { role: 'user', content: JSON.stringify(buildDialogRecastUserPayload(opts, draft)) },
      ],
    });
    if (!content.trim() || meta.finishReason === 'length') {
      logLlm.warn('dialog recast skipped: empty or truncated response');
      return draft;
    }
    return mergeDialogRecast(draft, parseRecastItems(content, opts.items));
  } catch (err) {
    logLlm.warn('dialog recast failed; keeping first-pass draft', {
      error: err instanceof Error ? err.message : String(err),
    });
    return draft;
  }
};
