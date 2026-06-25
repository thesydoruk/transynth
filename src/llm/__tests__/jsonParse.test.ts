import {
  parseLlmJson,
  stripMarkdownFence,
  extractJsonObject,
  repairLlmJsonContent,
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

  it('fixes trailing commas', () => {
    const parsed = parseLlmJson('{"items":[{"id":3,"translation":"A",},]}');
    expect(parsed).toEqual({ items: [{ id: 3, translation: 'A' }] });
  });

  it('strips stray trailing quote after JSON object', () => {
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

  it('repairs truncated JSON via jsonrepair', () => {
    const parsed = parseLlmJson('{"items":[{"id":1,"translation":"abc');
    expect(parsed).toEqual({ items: [{ id: 1, translation: 'abc' }] });
  });

  it('repairLlmJsonContent normalizes broken JSON', () => {
    const repaired = repairLlmJsonContent('{"items":[{"id":4,"translation":"OK"}]}"');
    expect(JSON.parse(repaired)).toEqual({ items: [{ id: 4, translation: 'OK' }] });
  });

  it('stripMarkdownFence and extractJsonObject helpers', () => {
    expect(stripMarkdownFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('noise {"b":2} noise')).toBe('{"b":2}');
  });
});
