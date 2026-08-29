import {
  buildSkipDetectResponseFormat,
  buildSkipDetectResponseSchema,
  buildTranslateResponseFormat,
  buildTranslateResponseSchema,
  buildVerifyResponseFormat,
  buildVerifyResponseSchema,
} from '../responseSchemas';

describe('responseSchemas', () => {
  it('builds translate schema with bounded items array', () => {
    const schema = buildTranslateResponseSchema(3);
    const items = schema.properties as Record<string, unknown>;
    const itemsProp = items.items as Record<string, unknown>;
    expect(itemsProp.minItems).toBe(3);
    expect(itemsProp.maxItems).toBe(3);

    const format = buildTranslateResponseFormat(3);
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.name).toBe('translate_batch');
    expect(format.json_schema.strict).toBe(true);
  });

  it('adds maxLength to translation when provided', () => {
    const schema = buildTranslateResponseSchema(1, 200);
    const items = (schema.properties as Record<string, unknown>).items as Record<string, unknown>;
    const translation = (
      (items.items as Record<string, unknown>).properties as Record<string, unknown>
    ).translation as { maxLength: number };
    expect(translation.maxLength).toBe(200);
  });

  it('builds verify schema with verdict enum', () => {
    const schema = buildVerifyResponseSchema(2);
    const items = (schema.properties as Record<string, unknown>).items as Record<string, unknown>;
    const itemSchema = (items.items as Record<string, unknown>).properties as Record<
      string,
      unknown
    >;
    const verdict = itemSchema.verdict as { enum: string[] };
    expect(verdict.enum).toEqual(['ok', 'suspicious', 'incorrect']);

    const format = buildVerifyResponseFormat(2);
    expect(format.json_schema.name).toBe('verify_batch');
  });

  it('builds skip-detect schema with skip/keep verdict enum', () => {
    const schema = buildSkipDetectResponseSchema(5);
    const items = (schema.properties as Record<string, unknown>).items as Record<string, unknown>;
    expect(items.minItems).toBe(5);
    expect(items.maxItems).toBe(5);

    const itemSchema = (items.items as Record<string, unknown>).properties as Record<
      string,
      unknown
    >;
    const verdict = itemSchema.verdict as { enum: string[] };
    expect(verdict.enum).toEqual(['skip', 'keep']);

    const format = buildSkipDetectResponseFormat(5);
    expect(format.json_schema.name).toBe('skip_detect_batch');
  });
});
