/** Few-shot JSON examples appended to localization system prompts. */

const INPUT_EXAMPLE = `{
  "source_language": "en",
  "target_language": "{targetLang}",
  "game": "fo4",
  "mod_name": "ExampleMod",
  "glossary": [
    { "term": "Brotherhood of Steel", "translation": "{glossaryBos}" }
  ],
  "items": [
    {
      "id": 101,
      "parts": ["I need ", 0, " caps for this rifle."],
      "slots": [{ "i": 0, "kind": "printf" }],
      "grup": "INFO",
      "field": "NAM1",
      "form_id": "01001234",
      "edid": "Vendor_BarterLine01",
      "context": "Travis"
    },
    {
      "id": 102,
      "parts": ["Brotherhood Combat Armor"],
      "grup": "ARMO",
      "field": "FULL",
      "form_id": "01005678",
      "edid": "Armor_BOS_Combat",
      "context": null
    }
  ]
}`;

const OUTPUT_EXAMPLE = `{
  "items": [
    { "id": 101, "parts": [{line101Parts}] },
    { "id": 102, "parts": ["{line102}"] }
  ]
}`;

const fill = (template: string, values: Record<string, string>): string => {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
};

/** English prompt examples — output follows the requested target language. */
export const buildEnglishPromptExamples = (targetLang: string): string => {
  const samples = sampleTranslationsForTarget(targetLang);

  return [
    'Example input:',
    fill(INPUT_EXAMPLE, {
      targetLang,
      glossaryBos: samples.glossaryBos,
    }),
    '',
    'Example output:',
    fill(OUTPUT_EXAMPLE, {
      line101Parts: samples.line101Parts,
      line102: samples.line102,
    }),
  ].join('\n');
};

const sampleTranslationsForTarget = (
  targetLang: string,
): {
  glossaryBos: string;
  line101Parts: string;
  line102: string;
} => {
  switch (targetLang.trim().toLowerCase()) {
    case 'de':
      return {
        glossaryBos: 'Stahlbruderschaft',
        line101Parts: '"Ich brauche ", 0, " Kronkorken für dieses Gewehr."',
        line102: 'Kampfrüstung der Stahlbruderschaft',
      };
    case 'pl':
      return {
        glossaryBos: 'Bractwo Stali',
        line101Parts: '"Potrzebuję ", 0, " kapsli za ten karabin."',
        line102: 'Pancerz bojowy Bractwa Stali',
      };
    case 'fr':
      return {
        glossaryBos: "Confrérie de l'Acier",
        line101Parts: '"Il me faut ", 0, " caps pour ce fusil."',
        line102: "Armure de combat de la Confrérie de l'Acier",
      };
    case 'es':
      return {
        glossaryBos: 'Hermandad del Acero',
        line101Parts: '"Necesito ", 0, " tapones por este rifle."',
        line102: 'Armadura de combate de la Hermandad del Acero',
      };
    case 'ru':
      return {
        glossaryBos: 'Братство Стали',
        line101Parts: '"Мне нужно ", 0, " крышек за эту винтовку."',
        line102: 'Боевой доспех Братства Стали',
      };
    case 'uk':
    case 'ua':
    case 'ukr':
    case 'ukrainian':
      return {
        glossaryBos: 'Братерство сталі',
        line101Parts: '"Мені потрібно ", 0, " кришок за цей карабін."',
        line102: 'Бойова броня Братерства сталі',
      };
    default:
      return {
        glossaryBos: 'Brotherhood of Steel',
        line101Parts: `"I need ", 0, " caps for this rifle. [translate to ${targetLang}]"`,
        line102: `Brotherhood Combat Armor [translate to ${targetLang}]`,
      };
  }
};
