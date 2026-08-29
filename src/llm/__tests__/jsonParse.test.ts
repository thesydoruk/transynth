import {
  parseLlmJson,
  tryParseLlmJson,
  peelStringWrappers,
  stripMarkdownFence,
  extractJsonObject,
  isJsonUnterminatedAtEnd,
  trySalvageTruncatedTranslateJson,
} from '../jsonParse';

describe('jsonParse', () => {
  it('parses fenced JSON', () => {
    const parsed = parseLlmJson('```json\n{"items":[{"id":1,"translation":"Тест"}]}\n```');
    expect(parsed).toEqual({ items: [{ id: 1, translation: 'Тест' }] });
  });

  it('extracts JSON from surrounding prose', () => {
    const parsed = parseLlmJson(
      'Here is the result:\n{"items":[{"id":2,"translation":"OK"}]}\nDone.',
    );
    expect(parsed).toEqual({ items: [{ id: 2, translation: 'OK' }] });
  });

  it('throws on trailing commas', () => {
    expect(() => parseLlmJson('{"items":[{"id":3,"translation":"A",},]}')).toThrow(
      /not valid JSON/,
    );
  });

  it('extracts JSON object when a stray quote follows', () => {
    const parsed = parseLlmJson('{"items":[{"id":4,"translation":"OK"}]}"');
    expect(parsed).toEqual({ items: [{ id: 4, translation: 'OK' }] });
  });

  it('unwraps JSON emitted as a string literal', () => {
    const inner = JSON.stringify({ items: [{ id: 5, translation: 'Wrapped' }] });
    const parsed = parseLlmJson(JSON.stringify(inner));
    expect(parsed).toEqual({ items: [{ id: 5, translation: 'Wrapped' }] });
  });

  it('throws on unrecoverable JSON', () => {
    expect(() => parseLlmJson('{{{', { operation: 'test' })).toThrow(/not valid JSON/);
  });

  it('throws on truncated JSON', () => {
    expect(() => parseLlmJson('{"items":[{"id":1,"translation":"abc')).toThrow(/not valid JSON/);
  });

  it('stripMarkdownFence and extractJsonObject helpers', () => {
    expect(stripMarkdownFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('noise {"b":2} noise')).toBe('{"b":2}');
  });

  it('peels nested JSON string wrappers', () => {
    const inner = '{"items":[{"id":1,"translation":"OK"}]}';
    expect(peelStringWrappers(JSON.stringify(JSON.stringify(inner)))).toBe(inner);
  });

  it('parses double-encoded translate JSON with echoed metadata on an item', () => {
    const inner = JSON.stringify({
      items: [
        { id: 1, translation: 'A' },
        {
          id: 2,
          translation: 'B',
          grup: 'TERM',
          edid: 'Foo',
          field: 'BTXT',
          form_id: '020A5056',
          context: null,
        },
      ],
    });
    const parsed = parseLlmJson(JSON.stringify(inner));
    expect(parsed).toEqual(JSON.parse(inner));
  });

  it('detects unterminated string at EOF', () => {
    const err = new SyntaxError('Unterminated string in JSON at position 42');
    expect(isJsonUnterminatedAtEnd(err, 42)).toBe(true);
    expect(isJsonUnterminatedAtEnd(err, 100)).toBe(false);
  });

  it('salvages truncated single-item translate JSON', () => {
    const inner = '{"items":[{"id":2177256,"translation":"Того дня в Цитаделі';
    const wrapped = JSON.stringify(inner);
    const salvaged = trySalvageTruncatedTranslateJson(wrapped, 2177256);
    expect(salvaged?.items[0]?.translation).toBe('Того дня в Цитаделі');
  });

  it('parses vLLM output when the outer string wrapper is missing its closing quote', () => {
    const inner = JSON.stringify({ items: [{ id: 2177256, translation: 'Готово' }] });
    const raw = JSON.stringify(inner).slice(0, -1);
    expect(tryParseLlmJson(raw)).toEqual({ items: [{ id: 2177256, translation: 'Готово' }] });
  });
});
