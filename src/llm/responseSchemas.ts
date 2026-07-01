/**
 * OpenAI / vLLM structured output schemas for batch LLM responses.
 */

export type LlmJsonObjectFormat = { type: 'json_object' };

export type LlmJsonSchemaFormat = {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
};

export type LlmResponseFormat = LlmJsonObjectFormat | LlmJsonSchemaFormat;

const boundedArray = (
  itemCount: number,
): { minItems: number; maxItems: number } | Record<string, never> =>
  itemCount > 0 ? { minItems: itemCount, maxItems: itemCount } : {};

/** JSON Schema for {@link translateStrings} batch responses. */
export const buildTranslateResponseSchema = (
  itemCount: number,
  maxTranslationLength?: number,
): Record<string, unknown> => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      ...boundedArray(itemCount),
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          translation: {
            type: 'string',
            ...(maxTranslationLength !== undefined ? { maxLength: maxTranslationLength } : {}),
          },
        },
        required: ['id', 'translation'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
});

/** JSON Schema for {@link verifyTranslationsWithLlm} batch responses. */
export const buildVerifyResponseSchema = (itemCount: number): Record<string, unknown> => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      ...boundedArray(itemCount),
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          verdict: { type: 'string', enum: ['ok', 'suspicious', 'incorrect'] },
          reason: { type: 'string' },
          confidence: { type: 'number' },
          suggestion: { type: ['string', 'null'] },
        },
        required: ['id', 'verdict', 'reason', 'confidence', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
});

export const buildTranslateResponseFormat = (
  itemCount: number,
  maxTranslationLength?: number,
): LlmJsonSchemaFormat => ({
  type: 'json_schema',
  json_schema: {
    name: 'translate_batch',
    strict: true,
    schema: buildTranslateResponseSchema(itemCount, maxTranslationLength),
  },
});

export const buildVerifyResponseFormat = (itemCount: number): LlmJsonSchemaFormat => ({
  type: 'json_schema',
  json_schema: {
    name: 'verify_batch',
    strict: true,
    schema: buildVerifyResponseSchema(itemCount),
  },
});

/** JSON Schema for {@link detectSkipCandidatesWithLlm} batch responses. */
export const buildSkipDetectResponseSchema = (itemCount: number): Record<string, unknown> => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      ...boundedArray(itemCount),
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          verdict: { type: 'string', enum: ['skip', 'keep'] },
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['id', 'verdict', 'reason', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
});

export const buildSkipDetectResponseFormat = (itemCount: number): LlmJsonSchemaFormat => ({
  type: 'json_schema',
  json_schema: {
    name: 'skip_detect_batch',
    strict: true,
    schema: buildSkipDetectResponseSchema(itemCount),
  },
});
