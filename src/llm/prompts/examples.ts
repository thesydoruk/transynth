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
      "source": "I need ¤PH0¤ caps for this rifle.",
      "signature": "INFO",
      "path": "INFO\\\\NAM1",
      "form_id": "01001234",
      "edid": "Vendor_BarterLine01",
      "context": "Travis"
    },
    {
      "id": 102,
      "source": "Brotherhood Combat Armor",
      "signature": "ARMO",
      "path": "ARMO\\\\FULL",
      "form_id": "01005678",
      "edid": "Armor_BOS_Combat",
      "context": null
    }
  ]
}`;

const OUTPUT_EXAMPLE = `{
  "items": [
    { "id": 101, "translation": "{line101}" },
    { "id": 102, "translation": "{line102}" }
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
      line101: samples.line101,
      line102: samples.line102,
    }),
  ].join('\n');
};

/** Ukrainian prompt examples — output is always Ukrainian. */
export const buildUkrainianPromptExamples = (): string => {
  return [
    'Приклад вхідних даних:',
    fill(INPUT_EXAMPLE, {
      targetLang: 'uk',
      glossaryBos: 'Братство Сталі',
    }),
    '',
    'Приклад відповіді:',
    fill(OUTPUT_EXAMPLE, {
      line101: 'Мені потрібно ¤PH0¤ кришок за цю гвинтівку.',
      line102: 'Бойова броня Братства Сталі',
    }),
  ].join('\n');
};

const sampleTranslationsForTarget = (targetLang: string): {
  glossaryBos: string;
  line101: string;
  line102: string;
} => {
  switch (targetLang.trim().toLowerCase()) {
    case 'de':
      return {
        glossaryBos: 'Stahlbruderschaft',
        line101: 'Ich brauche ¤PH0¤ Kronkorken für dieses Gewehr.',
        line102: 'Kampfrüstung der Stahlbruderschaft',
      };
    case 'pl':
      return {
        glossaryBos: 'Bractwo Stali',
        line101: 'Potrzebuję ¤PH0¤ kapsli za ten karabin.',
        line102: 'Pancerz bojowy Bractwa Stali',
      };
    case 'fr':
      return {
        glossaryBos: 'Confrérie de l\'Acier',
        line101: 'Il me faut ¤PH0¤ caps pour ce fusil.',
        line102: 'Armure de combat de la Confrérie de l\'Acier',
      };
    case 'es':
      return {
        glossaryBos: 'Hermandad del Acero',
        line101: 'Necesito ¤PH0¤ tapones por este rifle.',
        line102: 'Armadura de combate de la Hermandad del Acero',
      };
    case 'ru':
      return {
        glossaryBos: 'Братство Стали',
        line101: 'Мне нужно ¤PH0¤ крышек за эту винтовку.',
        line102: 'Боевой доспех Братства Стали',
      };
    case 'uk':
    case 'ua':
    case 'ukr':
    case 'ukrainian':
      return {
        glossaryBos: 'Братство Сталі',
        line101: 'Мені потрібно ¤PH0¤ кришок за цю гвинтівку.',
        line102: 'Бойова броня Братства Сталі',
      };
    default:
      return {
        glossaryBos: 'Brotherhood of Steel',
        line101: `I need ¤PH0¤ caps for this rifle. [translate to ${targetLang}]`,
        line102: `Brotherhood Combat Armor [translate to ${targetLang}]`,
      };
  }
};
