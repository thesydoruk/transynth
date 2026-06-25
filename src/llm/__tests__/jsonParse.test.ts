import { parseLlmJson, stripMarkdownFence, extractJsonObject } from '../jsonParse';

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

  it('fixes trailing commas', () => {
    const parsed = parseLlmJson('{"items":[{"id":3,"translation":"A",},]}');
    expect(parsed).toEqual({ items: [{ id: 3, translation: 'A' }] });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLlmJson('not json at all')).toThrow(/not valid JSON/);
  });

  it('stripMarkdownFence and extractJsonObject helpers', () => {
    expect(stripMarkdownFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('noise {"b":2} noise')).toBe('{"b":2}');
  });
});
