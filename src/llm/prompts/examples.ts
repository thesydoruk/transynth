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
      "grup": "INFO",
      "field": "NAM1",
      "form_id": "01001234",
      "edid": "Vendor_BarterLine01",
      "context": "Travis"
    },
    {
      "id": 102,
      "source": "Brotherhood Combat Armor",
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
      glossaryBos: 'Братерство сталі',
    }),
    '',
    'Приклад відповіді:',
    fill(OUTPUT_EXAMPLE, {
      line101: 'Мені потрібно ¤PH0¤ кришок за цей карабін.',
      line102: 'Бойова броня Братерства сталі',
    }),
    '',
    'Додатковий приклад (легендарний афікс + зброя):',
    'Вхід: {"id":110,"source":"Lucky Hunting Rifle","grup":"WEAP","field":"FULL"}',
    'Вихід: {"id":110,"translation":"Фартовий мисливський карабін"}',
    '',
    'Додатковий приклад (OMOD-слот броні):',
    'Вхід: {"id":111,"source":"Deep Pocketed","grup":"ARMO","field":"FULL","edid":"Mod_Armor_DeepPocket"}',
    'Вихід: {"id":111,"translation":"Глибокі кишені"}',
    '',
    'Додатковий приклад (фракційний прикметник у назві):',
    'Вхід: {"id":112,"source":"Railroad Gauntlets","grup":"ARMO","field":"FULL"}',
    'Вихід: {"id":112,"translation":"Підземні рукавиці"}',
    '',
    'Додатковий приклад (частина силової броні, ARMO/FULL):',
    'Вхід: {"id":103,"source":"T-51 Right Arm Armor","grup":"ARMO","field":"FULL","edid":"Armor_Power_T51_ArmRight"}',
    'Вихід: {"id":103,"translation":"Права рука T-51"}',
    'Альтернатива OK: {"id":103,"translation":"Броня T-51 для правої руки"}',
    '',
    'Додатковий приклад (деталь PA для крафту, MISC):',
    'Вхід: {"id":109,"source":"T-45d Arm Armor","grup":"MISC","field":"FULL"} → {"id":109,"translation":"Броня T-45d для руки"}',
    '',
    'Додатковий приклад (матеріали, FULL — без капсу):',
    'Вхід: {"id":104,"source":"Bamboo Fiber","grup":"MISC","field":"FULL"} → {"id":104,"translation":"Бамбукове волокно"}',
    'Вхід: {"id":105,"source":"Wood","grup":"MISC","field":"FULL"} → {"id":105,"translation":"Деревина"}',
    '',
    'Додатковий приклад (категорії UI — обидві частини українською):',
    'Вхід: {"id":106,"source":"Ammo - Ballistic","grup":"MISC","field":"FULL"} → {"id":106,"translation":"Боєприпаси — балістичні"}',
    'Вхід: {"id":107,"source":"Armor - Standard","grup":"MISC","field":"FULL"} → {"id":107,"translation":"Броня — стандартна"}',
    'Вхід: {"id":108,"source":"Weapon Parts","grup":"MISC","field":"FULL"} → {"id":108,"translation":"Деталі зброї"}',
  ].join('\n');
};

const sampleTranslationsForTarget = (
  targetLang: string,
): {
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
        glossaryBos: "Confrérie de l'Acier",
        line101: 'Il me faut ¤PH0¤ caps pour ce fusil.',
        line102: "Armure de combat de la Confrérie de l'Acier",
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
        glossaryBos: 'Братерство сталі',
        line101: 'Мені потрібно ¤PH0¤ кришок за цей карабін.',
        line102: 'Бойова броня Братерства сталі',
      };
    default:
      return {
        glossaryBos: 'Brotherhood of Steel',
        line101: `I need ¤PH0¤ caps for this rifle. [translate to ${targetLang}]`,
        line102: `Brotherhood Combat Armor [translate to ${targetLang}]`,
      };
  }
};
