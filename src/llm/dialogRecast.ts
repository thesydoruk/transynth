/**
 * Optional second LLM pass over a finished translation draft.
 *
 * Whether a game has one, and what it says, is the game's business: a plugin
 * declares `prompts.recast` and this module runs it. Fallout 4's Ukrainian
 * dialogue is the only user today.
 */
import { chatWithFallback } from './index';
import { gamePlugin } from '../games/registry';
import { parseLlmItemId, parseLlmJson } from './jsonParse';
import { participantPayloadFields } from './dialogParticipants';
import { compactLlmItemFields } from './llmPayloadCompact';
import { dialogScenePayload, type DialogSceneContext } from './dialogScene';
import { logLlm } from '../logging/loggers';
import { resolveBatchPromptFamily, type LlmPromptFamily } from './promptFamily';
import { buildTranslateResponseFormat } from './responseSchemas';
import type { GameId } from '../types';
import type { LlmTranslateOptions, LlmTranslateResult } from './translate';
import { alignTextToSlots, assembleTranslatedText, compactLlmPartsFields } from './textParts';

export type DialogRecastCheck = {
  game?: GameId | string | null;
  targetLang: string;
  promptFamily?: LlmPromptFamily | null;
  items: Array<{ grup?: string | null; field?: string | null }>;
  skipDialogRecast?: boolean;
};

/** The game's recast pass, when it has one and it applies to this batch. */
export const resolveDialogRecast = (opts: DialogRecastCheck): { prompt: string } | null => {
  if (opts.skipDialogRecast) return null;
  const recast = gamePlugin(opts.game).prompts.recast;
  if (!recast) return null;
  const family = resolveBatchPromptFamily(opts.game, opts.items, opts.promptFamily);
  return recast.appliesTo(opts.targetLang, family) ? { prompt: recast.prompt } : null;
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
export const recastDialogTranslations = async (
  opts: LlmTranslateOptions,
  draft: LlmTranslateResult[],
): Promise<LlmTranslateResult[]> => {
  if (draft.length === 0) return draft;
  const recast = resolveDialogRecast(opts);
  if (!recast) return draft;

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
        { role: 'system', content: recast.prompt },
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
