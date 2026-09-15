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

const llmPartsItemSchema = (maxStringLength?: number): Record<string, unknown> => ({
  anyOf: [
    {
      type: 'string',
      ...(maxStringLength !== undefined ? { maxLength: maxStringLength } : {}),
    },
    { type: 'integer', minimum: 0 },
  ],
});

const llmPartsArraySchema = (maxStringLength?: number): Record<string, unknown> => ({
  type: 'array',
  minItems: 1,
  items: llmPartsItemSchema(maxStringLength),
});

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
          parts: llmPartsArraySchema(maxTranslationLength),
        },
        required: ['id', 'parts'],
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
          suggestion: {
            anyOf: [{ type: 'null' }, { type: 'string' }, llmPartsArraySchema()],
          },
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

const buildPreferredTranslationSchema = (itemCount: number): Record<string, unknown> => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      ...boundedArray(itemCount),
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          choice: { type: 'string', enum: ['current', 'candidate'] },
        },
        required: ['id', 'choice'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
});

/** JSON Schema for the current-versus-candidate comparison batch. */
export const buildPreferredTranslationResponseFormat = (
  itemCount: number,
): LlmJsonSchemaFormat => ({
  type: 'json_schema',
  json_schema: {
    name: 'preferred_translation_batch',
    strict: true,
    schema: buildPreferredTranslationSchema(itemCount),
  },
});

const buildNarratorGenderDetectResponseSchema = (itemCount: number): Record<string, unknown> => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      ...boundedArray(itemCount),
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          narrator_gender: { type: 'string', enum: ['male', 'female', 'neutral', 'unknown'] },
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['id', 'narrator_gender', 'reason', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
});

export const buildNarratorGenderDetectResponseFormat = (
  itemCount: number,
): LlmJsonSchemaFormat => ({
  type: 'json_schema',
  json_schema: {
    name: 'narrator_gender_detect_batch',
    strict: true,
    schema: buildNarratorGenderDetectResponseSchema(itemCount),
  },
});
