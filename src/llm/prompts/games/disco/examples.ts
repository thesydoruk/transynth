/**
 * English (non-UK target) few-shot for Disco Translator packs.
 * Ukrainian few-shots live inline in translate.ts / verify.ts (FO4 style).
 */
export const buildEnglishDiscoPromptExamples = (targetLang: string): string =>
  [
    'Example input:',
    '{',
    '  "source_language": "en",',
    `  "target_language": "${targetLang}",`,
    '  "game": "disco",',
    '  "items": [',
    '    { "id": 101, "source": "This is the RCM.", "grup": "PO", "edid": "Kim Kitsuragi" },',
    '    { "id": 102, "source": "Heal Volition [1]", "grup": "PO" },',
    '    { "id": 103, "source": "You feel uncertain, like a child who\'s lost his mother in the crowd.", "grup": "PO", "edid": "Volition" }',
    '  ]',
    '}',
    '',
    'Example output:',
    '{',
    '  "items": [',
    `    { "id": 101, "translation": "<${targetLang}: RCM line in Kim's dry professional register>" },`,
    `    { "id": 102, "translation": "<${targetLang}: Heal + canonical Volition + [1]>" },`,
    `    { "id": 103, "translation": "<${targetLang}: Volition addressing Harry informally, keep the simile>" }`,
    '  ]',
    '}',
  ].join('\n');
