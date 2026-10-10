/**
 * English (non-UK target) few-shot for The Witcher 3 string tables.
 * Ukrainian few-shots live inline in translate.ts / verify.ts.
 */
export const buildEnglishWitcher3PromptExamples = (targetLang: string): string =>
  [
    'Example input:',
    '{',
    '  "source_language": "en",',
    `  "target_language": "${targetLang}",`,
    '  "game": "w3",',
    '  "items": [',
    '    { "id": 101, "parts": ["Wind\'s howling."], "grup": "W3S" },',
    '    { "id": 102, "parts": ["Please, master witcher, help us."], "grup": "W3S" },',
    '    { "id": 103, "parts": ["Meditate"], "grup": "W3S", "edid": "panel_button_common_meditation" }',
    '  ]',
    '}',
    '',
    'Example output:',
    '{',
    '  "items": [',
    `    { "id": 101, "parts": ["<${targetLang}: Geralt's terse remark, masculine>"] },`,
    `    { "id": 102, "parts": ["<${targetLang}: a peasant pleading, formal register towards Geralt>"] },`,
    `    { "id": 103, "parts": ["<${targetLang}: compact UI command>"] }`,
    '  ]',
    '}',
  ].join('\n');
