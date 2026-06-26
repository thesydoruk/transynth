import {
  parseLlmJson,
  peelStringWrappers,
  stripMarkdownFence,
  extractJsonObject,
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
});
