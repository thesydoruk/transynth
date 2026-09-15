import { buildEnglishTranslateSystemPrompt, buildEnglishVerifySystemPrompt } from '../../en';
import { buildUkrainianTranslateSystemPrompt, buildUkrainianVerifySystemPrompt } from '../../uk';
import { buildEnglishTranslationRules, buildEnglishVerifyTranslationRules } from '../index';
import { resolveGameId } from '../../../../games/registry';

describe('translationRules', () => {
  it('includes common and game-specific sections for English', () => {
    const fo4Rules = buildEnglishTranslationRules('de', 'fo4');
    expect(fo4Rules).toContain('### SLOTS AND TAG PRESERVATION');
    expect(fo4Rules).toContain('### CAPITALIZATION:');
    expect(fo4Rules).toContain('### STYLE, TONE, AND ATMOSPHERE (Fallout 4):');
    expect(fo4Rules).toContain('### FALLOUT 4 CANONICAL TERMINOLOGY');
    expect(fo4Rules).toContain('### MCM MENU STRINGS (grup MCM)');
    expect(fo4Rules).toContain('Stealth Boy');
    expect(fo4Rules).toContain('Institute');
  });

  it('interpolates target language in linguistic quality', () => {
    expect(buildEnglishTranslationRules('pl', 'fo4')).toContain('idiomatic pl');
  });

  it('defaults unknown game to fo4', () => {
    expect(resolveGameId(null)).toBe('fo4');
    expect(resolveGameId('unknown-mod')).toBe('fo4');
    expect(buildUkrainianTranslateSystemPrompt('en', null)).toBe(
      buildUkrainianTranslateSystemPrompt('en', 'fo4'),
    );
  });

  it('sle shares prompts with sse', () => {
    expect(buildUkrainianTranslateSystemPrompt('en', 'sle')).toBe(
      buildUkrainianTranslateSystemPrompt('en', 'sse'),
    );
    expect(buildUkrainianVerifySystemPrompt('en', 'sle')).toBe(
      buildUkrainianVerifySystemPrompt('en', 'sse'),
    );
  });

  it('is injected into translate and verify prompts with game', () => {
    const rules = buildEnglishTranslationRules('de', 'fo4');
    const verifyRules = buildEnglishVerifyTranslationRules('de', 'fo4');
    const translatePrompt = buildEnglishTranslateSystemPrompt('en', 'de', 'fo4');
    const verifyPrompt = buildEnglishVerifySystemPrompt('en', 'de', 'fo4');
    expect(translatePrompt).toContain(rules);
    expect(verifyPrompt).toContain(verifyRules);
    expect(verifyPrompt).toContain('VERIFY — item/mod names');
  });

  it('uses per-game Ukrainian standalone prompts', () => {
    const fo4 = buildUkrainianTranslateSystemPrompt('en', 'fo4');
    const fnv = buildUkrainianTranslateSystemPrompt('en', 'fnv');
    const sse = buildUkrainianTranslateSystemPrompt('en', 'sse');
    expect(fo4).toContain('### 1. ТЕХНІЧНИЙ ФОРМАТ');
    expect(fo4).toContain('Fallout 4');
    expect(fnv).toContain('FALLOUT: NEW VEGAS');
    expect(sse).toContain('SKYRIM');
    expect(fnv).not.toContain('### ТЕХНІЧНІ ВИМОГИ');
  });

  it('injects game-specific verify rules for Ukrainian Fallout 4', () => {
    const verifyPrompt = buildUkrainianVerifySystemPrompt('en', 'fo4');
    expect(verifyPrompt).toContain('### 4. НАЗВИ');
    expect(verifyPrompt).toContain('Hellfire');
    expect(verifyPrompt).toContain('reference_examples');
    const skyrimVerify = buildUkrainianVerifySystemPrompt('en', 'sse');
    expect(skyrimVerify).toContain('Лексика Fallout');
    expect(skyrimVerify).not.toContain('силової броні');
  });

  it('uses a Disco-specific Ukrainian prompt, not Bethesda rules', () => {
    const translate = buildUkrainianTranslateSystemPrompt('en', 'disco');
    const verify = buildUkrainianVerifySystemPrompt('en', 'disco');
    expect(translate).toContain('### 1. ТЕХНІЧНИЙ ФОРМАТ');
    expect(translate).toContain('### 4. УЗГОДЖЕНІСТЬ, ТЕРМІНОЛОГІЯ ТА МЕТАДАНІ');
    expect(translate).toContain('### 5. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (DISCO ELYSIUM)');
    expect(translate).toContain('### 7. ПРИКЛАДИ ВХОДУ ТА ВИХОДУ');
    expect(translate).toContain('reference_examples');
    expect(translate).toContain('Disco Elysium');
    expect(translate).toContain('Напівсвітло');
    expect(translate).toContain('Навіювання');
    expect(translate).toContain('підар');
    expect(translate).toContain('сцикуняка');
    expect(translate).toContain('Зцілити Волю [1]');
    expect(translate).not.toContain('ESP/ESM');
    expect(translate).not.toContain('кришок');
    expect(translate).not.toContain('Піп-боя');
    expect(verify).toContain('### 6. СПЕЦИФІЧНІ ПРАВИЛА ЛОКАЛІЗАЦІЇ (DISCO ELYSIUM)');
    expect(verify).toContain('голоси навичок');
    expect(verify).toContain('reference_examples');
    expect(verify).not.toContain('ESP/ESM');
    expect(verify).not.toContain('addressee_gender: "any"');
    expect(verify).not.toContain('Піп-боя');
    expect(translate).not.toContain('сонечко');
    expect(translate).not.toContain('любий');
    expect(verify).not.toContain('сонечко');
  });

  it('tells Bethesda Ukrainian prompts to use gender-neutral endearments', () => {
    const fo4 = buildUkrainianTranslateSystemPrompt('en', 'fo4', 'dialog');
    const verify = buildUkrainianVerifySystemPrompt('en', 'fo4', 'dialog');
    expect(fo4).toContain('сонечко');
    expect(fo4).toContain('золотко');
    expect(fo4).toContain('серденько');
    expect(fo4).toContain('НІКОЛИ «любий» / «люба»');
    expect(fo4).toContain('Весь рядок, не лише звертання');
    expect(fo4).toContain('Дякую за допомогу, сонечко.');
    expect(fo4).toContain('Сонечко, можеш допомогти?');
    expect(fo4).toContain('Оце так, золотко.');
    expect(fo4).toContain('Перепиши **весь** присудок');
    expect(fo4).toContain('До війни — армія.');
    expect(fo4).not.toContain('зіронько');
    expect(fo4).not.toContain('Ви прекрасні, золотко.');
    expect(verify).toContain('сонечко');
    expect(verify).toContain('любий');
    expect(verify).toContain('весь');
  });

  it('uses wasteland ти for FO4 dialog and keeps formal ви in other Bethesda games', () => {
    const item = buildUkrainianTranslateSystemPrompt('en', 'fo4');
    const dialog = buildUkrainianTranslateSystemPrompt('en', 'fo4', 'dialog');
    const mcm = buildUkrainianTranslateSystemPrompt('en', 'fo4', 'mcm');
    const quest = buildUkrainianTranslateSystemPrompt('en', 'fo4', 'quest');
    const dialogVerify = buildUkrainianVerifySystemPrompt('en', 'fo4', 'dialog');
    const sse = buildUkrainianTranslateSystemPrompt('en', 'sse');
    expect(item).toContain('Піп-боя');
    expect(item).toContain('Учениці');
    expect(item).toContain('мисливець');
    expect(item).toContain('зброєносець');
    expect(item).not.toContain('Адаптація, не підрядник');
    expect(item).not.toContain('завжди «ви»');
    expect(dialog).toContain('пустка на ти');
    expect(dialog).toContain('Адаптація, не підрядник');
    expect(dialog).toContain('Як діятимемо?');
    expect(dialog).toContain('field: "RNAM"');
    expect(dialog).toContain('Нік — коротко й сухо');
    expect(dialog).toContain('Додай мат');
    expect(dialog).toContain('Валіть нахуй звідси!');
    expect(dialog).not.toContain('Не додавай мат у чистий EN');
    expect(dialog).toContain('sir/mum');
    expect(dialog).toContain('Ну що, рушаємо?');
    expect(dialog).toContain('З тобою інакше');
    expect(dialog).toContain('Не міняй чоловічий рід на жіночий');
    expect(dialog).toContain('дволична людина');
    expect(dialog).toContain('Ще не ясно, чи зможу');
    expect(dialog).toContain('Ви можете розправитися з тими гулями');
    expect(dialog).toContain('Я ціную ваші зусилля');
    expect(dialog).toContain('Зробіть самі');
    expect(dialog).toContain('Та що у вас за рахунки з Ніком');
    expect(dialog).toContain('Знаю, що прошу багато');
    expect(dialog).toContain("Пам'ятаєш кар'єр");
    expect(dialog).toContain('Я вже давно на тебе чекаю');
    expect(dialog).toContain('Ще нікого');
    expect(dialog).toContain('як зможеш');
    expect(dialog).toContain('Бережи себе.');
    expect(dialog).toContain('Будь обережною там. Будь обережним там.');
    expect(dialog).toContain('Будьте обережні.');
    expect(dialog).toContain('ОДНА');
    expect(mcm).toContain('MCM (grup: MCM)');
    expect(mcm).toContain('help=');
    expect(quest).toContain('Знайди мисливця');
    expect(dialogVerify).toContain('Ну що, рушаємо?');
    expect(dialogVerify).toContain('підрядник');
    expect(dialogVerify).toContain('Як діятимемо?');
    expect(dialogVerify).toContain('З тобою інакше');
    expect(dialogVerify).toContain('що б ти не казав');
    expect(dialogVerify).toContain('дволична людина');
    expect(dialogVerify).toContain('Чи зможеш ти');
    expect(dialogVerify).toContain('Ви відправили мене');
    expect(dialogVerify).toContain('це багато що');
    expect(dialogVerify).toContain('Ще нікого не знайшла');
    expect(dialogVerify).toContain('не «нейтрально»');
    expect(dialogVerify).toContain('як зможеш');
    expect(dialogVerify).toContain('Бережи себе.');
    expect(dialogVerify).toContain('Будь обережною там. Будь обережним там.');
    expect(sse).toContain('завжди «ви»');
    const enFo4 = buildEnglishTranslationRules('de', 'fo4');
    expect(enFo4).toContain('SECOND-PERSON REGISTER (Fallout 4)');
    expect(enFo4).toContain('ADAPTATION (spoken lines, not UI labels)');
    expect(enFo4).toContain('INFO, DIAL, BOOK, NOTE, TERM, QUST, MESG');
  });

  it('keeps English Disco prompts free of Creation Kit and Fallout gear', () => {
    const translate = buildEnglishTranslateSystemPrompt('en', 'de', 'disco');
    const verify = buildEnglishVerifySystemPrompt('en', 'de', 'disco');
    const rules = buildEnglishTranslationRules('de', 'disco');
    expect(rules).toContain('Inland Empire');
    expect(rules).toContain('Lockit markup');
    expect(rules).toContain('faggot → підар');
    expect(rules).toContain('*word*');
    expect(rules).toContain('Half Light');
    expect(rules).not.toContain('Stealth Boy');
    expect(translate).toContain('Disco Translator Final Cut');
    expect(translate).not.toContain('ESP/ESM');
    expect(translate).not.toContain('Brotherhood of Steel');
    expect(verify).toContain('gettext .po');
    expect(verify).not.toContain('Operators Light Arm Armor');
    expect(verify).not.toContain('Pip-Boy');
  });
});
