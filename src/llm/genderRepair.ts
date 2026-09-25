/**
 * Second chance for a line that leaked a gender the metadata forbids.
 *
 * The prompt already spells out how to phrase a player line so it reads for
 * either gender; a model that got it wrong once will not be fixed by being
 * shown that rule again. What does work is naming the offending words and
 * asking for that one line back, so this pass sends only the lines the detector
 * caught, each with the exact forms to remove.
 *
 * Best effort throughout: if the repair call fails, is truncated, or comes back
 * still leaking, the original draft is kept and the QA check will flag it.
 */
import { chatWithFallback } from './index';
import {
  findGenderLeaks,
  genderAgreementInstruction,
  genderRetryInstruction,
  isGenderGuardLanguage,
  isPlayerGenderConflict,
} from './genderGuard';
import { parseLlmItemId, parseLlmJson } from './jsonParse';
import { compactLlmItemFields } from './llmPayloadCompact';
import { participantPayloadFields } from './dialogParticipants';
import { logLlm } from '../logging/loggers';
import { buildGenderRepairResponseFormat } from './responseSchemas';
import { alignTextToSlots, assembleTranslatedText, compactLlmPartsFields } from './textParts';
import type { LlmTranslateOptions, LlmTranslateResult } from './translate';

/** One worked repair: the wording that leaked, and a wording that does not. */
export type GenderRepairExample = {
  /** Whose gender the line gives away: the player speaking, or being spoken to. */
  role: 'speaker' | 'addressee';
  source: string;
  problem: string;
  leaking: string;
  repaired: string;
};

/**
 * Worked repairs, every one of them a line this pipeline actually produced.
 *
 * They are here to teach the move, not the wording: each `repaired` reaches for
 * a different construction — present tense, impersonal, the -но passive, a noun
 * subject, a possessive, a consequence — because the one thing that never works
 * is patching the verb and hoping. Every `repaired` is checked against the same
 * detector that rejects the drafts, so an example can never quietly teach the
 * model to leave a marker standing. The example this list replaced did exactly
 * that: it offered «Тобто це ти робив операцію?» as the correct answer.
 */
export const UK_GENDER_REPAIR_EXAMPLES: readonly GenderRepairExample[] = [
  {
    role: 'speaker',
    source: 'Yeah. I took care of them.',
    problem: '«подбав» закріплює чоловічий рід мовця, хоч його обирає гравець',
    leaking: 'Так. Я подбав про них.',
    repaired: 'Так. Про них подбали.',
  },
  {
    role: 'addressee',
    source: 'So you were performing surgery?',
    problem: '«проводив» закріплює чоловічий рід адресата, хоч його обирає гравець',
    leaking: 'Тобто ти проводив операцію?',
    repaired: 'Тобто це ти оперуєш?',
  },
  {
    role: 'speaker',
    source: 'I was in a Vault.',
    problem: '«був» закріплює чоловічий рід мовця, хоч його обирає гравець',
    leaking: 'Я був у Сховищі.',
    repaired: 'Я зі Сховища.',
  },
  {
    role: 'speaker',
    source: 'I saved your lives. You should be grateful.',
    problem: 'слеш «врятував/ла» підставляє дві статі замість того, щоб прибрати рід',
    leaking: 'Я врятував/ла вам життя. Будьте вдячні.',
    repaired: 'Завдяки мені ви живі. Будьте вдячні.',
  },
  {
    role: 'addressee',
    source: "You've been to a Vault?",
    problem: '«бував» закріплює чоловічий рід адресата, хоч його обирає гравець',
    leaking: 'Ти вже бував у Сховищі?',
    repaired: 'Тобі вже доводилося бувати у Сховищі?',
  },
  {
    role: 'speaker',
    source: "Codsworth, I already looked. They're not here.",
    problem: '«перевірив» закріплює чоловічий рід мовця, хоч його обирає гравець',
    leaking: 'Кодсворте, я вже перевірив. Їх тут немає.',
    repaired: 'Кодсворте, там уже все перевірено. Їх тут немає.',
  },
  {
    role: 'speaker',
    source: "I would've spared them if I could've.",
    problem: 'слеші «пощадив/ла» і «міг/могла» підставляють дві статі замість переказу',
    leaking: 'Я б їх пощадив/ла, якби міг/могла.',
    repaired: 'Якби була змога, вони б лишилися живі.',
  },
  {
    role: 'addressee',
    source: "For all you've done you deserve it.",
    problem: '«зробив» і «заслужив» закріплюють чоловічий рід адресата',
    leaking: 'За все, що ти зробив, ти на це заслужив.',
    repaired: 'За всі твої заслуги це твоє по праву.',
  },
  {
    role: 'speaker',
    source: "No, I changed my mind. I don't need the password.",
    problem: 'слеш «передумав/ла» підставляє дві статі замість того, щоб прибрати рід',
    leaking: 'Ні, я передумав/ла. Пароль не потрібен.',
    repaired: 'Ні, я вже не хочу. Пароль не потрібен.',
  },
  {
    role: 'speaker',
    source: 'I am no thief.',
    problem: 'іменник-діяч «злодій» закріплює чоловічий рід мовця, хоч його обирає гравець',
    leaking: 'Я не злодій.',
    repaired: 'Я не краду.',
  },
  {
    role: 'addressee',
    source: 'You owe me.',
    problem: '«винен» закріплює чоловічий рід адресата, хоч його обирає гравець',
    leaking: 'Ти мені винен.',
    repaired: 'За тобою борг.',
  },
  {
    role: 'addressee',
    source: 'You built this robot yourself?',
    problem: '«сам» закріплює чоловічий рід адресата, хоч його обирає гравець',
    leaking: 'Ти сам цього робота зібрав?',
    repaired: 'Цей робот — твоїх рук справа?',
  },
  {
    role: 'addressee',
    source: 'Lost in thought?',
    problem: '«замислився» закріплює чоловічий рід адресата, хоч його обирає гравець',
    leaking: 'Замислився?',
    repaired: 'Голову ламаєш?',
  },
  {
    role: 'addressee',
    source: "You were ready to give up Marowski's secret lab to save your skin.",
    problem: 'присудковий прикметник «готовий» закріплює чоловічий рід адресата',
    leaking: 'Ти ж готовий був здати секретну лабораторію Маровського.',
    repaired: 'У тебе ж не було вагань — секретна лабораторія Маровського за власну шкуру.',
  },
];

type WorkedExample = { source: string; problem: string; leaking: string; repaired: string };

const exampleBlock = (examples: readonly WorkedExample[]): string => {
  const line = (value: object): string => `  ${JSON.stringify(value)}`;
  const input = examples
    .map((example, index) =>
      line({
        id: index + 1,
        source: example.source,
        translation: example.leaking,
        problem: example.problem,
      }),
    )
    .join(',\n');
  const output = examples
    .map((example, index) => line({ id: index + 1, variants: [[example.repaired]] }))
    .join(',\n');
  return `{"items":[\n${input}\n]}\n{"items":[\n${output}\n]}`;
};

/**
 * How many rewordings the neutralising prompts may offer per line.
 *
 * The pass used to ask for one wording and keep it only if the detector
 * passed it, which left one in six lines unrepaired — not because the model
 * cannot neutralise a line, but because its first attempt patched the verb
 * or kept the marker somewhere else. Asking for a few attempts in the same
 * call and letting the detector choose costs no extra request, and is a
 * different mechanism from adding rules to the prompt, which measurably makes
 * this model hand more lines back untouched.
 *
 * Measured on 60 real leaking Fallout 4 lines against gemma4:26b-a4b, same
 * detector on both sides: one wording 55/60 clean (five handed back
 * untouched), three variants 59/60 (one untouched).
 */
const GENDER_REPAIR_VARIANTS = 3;

const NEUTRAL_OUTPUT_FORMAT = `Вихід: лише JSON {"items":[{"id":<number>,"variants":[[...],[...],[...]]}]}. Для кожного id — до ${GENDER_REPAIR_VARIANTS} різних перефраз, кожна окремим масивом parts; найприродніша перша. Ті самі id, той самий порядок. Без markdown. Числа в parts — слоти з входу.`;

const AGREEMENT_OUTPUT_FORMAT = `Вихід: лише JSON {"items":[{"id":<number>,"variants":[[...]]}]}. Один масив parts на id. Ті самі id, той самий порядок. Без markdown. Числа в parts — слоти з входу.`;

/**
 * Techniques for a line the player speaks about themselves.
 *
 * The subject is the one to get rid of: Ukrainian marks the speaker on the
 * predicate, so the repair moves the sentence off «я» altogether.
 */
const SPEAKER_TECHNIQUES = `  - безособове: «я подбав про них» → «про них подбали»;
  - пасив на -но/-то: «я вже перевірив» → «там уже все перевірено»;
  - теперішній час замість минулого: «я передумав» → «я вже не хочу»;
  - іменник замість дієслова: «я був у Сховищі» → «я зі Сховища»;
  - підмет-іменник замість «я»: «якби я міг» → «якби була змога»;
  - дієслово замість іменника-діяча: «я не злодій» → «я не краду»;
  - наслідок замість дії: «я врятував вам життя» → «завдяки мені ви живі».`;

/**
 * Techniques for a line an NPC addresses to the player.
 *
 * On the production corpus this is 60 of the 69 lines that have to lose a
 * gender — an NPC talking at the player says «ти зробив», «ти готовий», «ти
 * пройшов» constantly. Here «ти» itself is fine and stays; what has to go is
 * the marked predicate hanging off it, so the moves turn the addressee's action
 * or quality into something the sentence can name instead of conjugate.
 */
const ADDRESSEE_TECHNIQUES = `  - дію адресата — в подію, стан або річ: «ти пройшов Шлях Свободи» → «Шлях Свободи вже позаду»; «ти запізнився» → «запізно»;
  - присвійне замість присудка: «що ти зробив» → «твої заслуги»; «ти сам зібрав» → «твоїх рук справа»; «ти мені винен» → «за тобою борг»;
  - теперішній час замість минулого: «ти проводив операцію» → «це ти оперуєш»;
  - «доводилося» + інфінітив: «ти бував» → «тобі доводилося бувати»;
  - заперечення наявності: «ти був готовий» → «у тебе не було вагань»;
  - наслідок замість дії: «ти зробив Стіну синьою» → «Стіна тепер синя завдяки тобі»;
  - питання про річ, а не про дію: «у яку гру ти грав?» → «що це була за гра?».`;

const neutralPrompt = (
  role: 'speaker' | 'addressee',
): string => `Ти — редактор українського перекладу. У кожному рядку вже знайдено конкретну помилку роду; вона вказана в полі "problem". ${
  role === 'speaker'
    ? 'Рід мовця обирає гравець, тож репліка не сміє його називати.'
    : 'Рід адресата обирає гравець, тож репліка не сміє його називати. Саме «ти» лишається — прибрати треба маркований присудок.'
}

Вхід: JSON з "items" (id, parts/source, translation_parts/translation, problem, speaker, speaker_gender, addressee, addressee_gender).
${NEUTRAL_OUTPUT_FORMAT}

### ЩО РОБИТИ
- Збережи **зміст, голос мовця, регістр і лайку**. Слова й довжина — вільні. Рядок може стати довшим, може взяти інші слова, може переставити акценти: це художня адаптація, а не буквальний переклад. Довша природна репліка краща за коротку дерев'яну.
- Слоти (числа з входу) перенеси всі до одного.
- Межа проходить по **змісту й наміру, а не по словах**: не додавай подій, не прибирай сказаного, не міняй, хто що зробив, не перетворюй питання на ствердження. У цих рамках стискати й перефразовувати можна вільно.
- Перепиши **конструкцію**, а не рід. Патч дієслова не працює: «Я подбав» → «Я про це подбав» — рід лишився. Міняй будову речення:
${role === 'speaker' ? SPEAKER_TECHNIQUES : ADDRESSEE_TECHNIQUES}
- Рід тече не лише в дієсловах минулого часу: присудкові прикметники («готовий», «впевнена»), дієприкметники («здивований»), іменники-діячі («злодій», «задрот», «новачок») і «сам/сама» роблять те саме.
- **Жива мова, не канцелярит.** «Замислився?» → «Голову ламаєш?», а не «У замислах?».
- Рід у словах про ІНШИХ чіпати не треба: «Ерл був мертвий» лишається як є.
- Заборонено: міняти чоловічий рід на жіночий і навпаки, слеш «зробив/ла», дві статі підряд, «ви»/«будьте» як милиця роду.
- Кожна перефраза — одна цілісна репліка. Не склеюй варіанти в один рядок.
- Без змін повертай лише тоді, коли жоден прийом не дав природної репліки. Це рідкість.

### ПРИКЛАДИ
${exampleBlock(UK_GENDER_REPAIR_EXAMPLES.filter((example) => example.role === role))}`;

const UK_GENDER_SPEAKER_PROMPT = neutralPrompt('speaker');
const UK_GENDER_ADDRESSEE_PROMPT = neutralPrompt('addressee');

/** One worked agreement fix, for a participant whose gender is known. */
export type GenderAgreementExample = {
  source: string;
  problem: string;
  leaking: string;
  repaired: string;
};

/**
 * Agreement, not concealment. Each answer keeps every word of the draft and
 * changes only the ending that disagreed.
 */
export const UK_GENDER_AGREEMENT_EXAMPLES: readonly GenderAgreementExample[] = [
  {
    source: 'I have completed my analysis of the data.',
    problem: 'Рід не збігається: «завершив» → жіночий рід (мовець — female).',
    leaking: 'Я завершив аналіз даних.',
    repaired: 'Я завершила аналіз даних.',
  },
  {
    source: 'Are you ready?',
    problem: 'Рід не збігається: «готовий» → жіночий рід (адресат — female).',
    leaking: 'Ти готовий?',
    repaired: 'Ти готова?',
  },
  {
    source: 'I did it myself.',
    problem: 'Рід не збігається: «сам» → жіночий рід (мовець — female).',
    leaking: 'Я сам це зробив.',
    repaired: 'Я сама це зробила.',
  },
  {
    source: 'You were surprised to hear it.',
    problem: 'Рід не збігається: «здивована» → чоловічий рід (адресат — male).',
    leaking: 'Ти була здивована, коли почула.',
    repaired: 'Ти був здивований, коли почув.',
  },
];

const UK_GENDER_AGREEMENT_PROMPT = `Ти — редактор українського перекладу. У кожному рядку названі форми стоять не в тому роді; потрібний рід указаний у полі "problem".

Вхід: JSON з "items" (id, parts/source, translation_parts/translation, problem, speaker, speaker_gender, addressee, addressee_gender).
${AGREEMENT_OUTPUT_FORMAT}

### ЩО РОБИТИ
- Постав названі форми в рід, указаний у "problem". Це заміна закінчення: «вирішив» → «вирішила», «готовий» → «готова», «сам» → «сама», «була здивована» → «був здивований».
- Узгодь усе, що тягнеться за цією формою в тому ж реченні: «Ти була здивована, коли почула» → «Ти був здивований, коли почув».
- Більше **нічого** не чіпай: ні слова, ні порядок, ні пунктуацію, ні довжину.
- **Не нейтралізуй рід і не перефразовуй.** Стать учасника відома — її треба показати, а не сховати. Безособове «завершено» тут помилка.
- Рід у словах про ІНШИХ не чіпай: «Ерл був мертвий» лишається як є.
- Одна репліка на виході.

### ПРИКЛАДИ
${exampleBlock(UK_GENDER_AGREEMENT_EXAMPLES)}`;

type RepairKind = 'speaker' | 'addressee' | 'agreement';

type RepairTarget = {
  kind: RepairKind;
  item: LlmTranslateOptions['items'][number];
  draft: string;
  problem: string;
};

const collectTargets = (opts: LlmTranslateOptions, draft: LlmTranslateResult[]): RepairTarget[] => {
  const itemById = new Map(opts.items.map((item) => [item.id, item]));
  const targets: RepairTarget[] = [];

  for (const row of draft) {
    const item = itemById.get(row.id);
    if (!item || !row.translation.trim()) continue;
    const leaks = findGenderLeaks(row.translation, item, opts.targetLang);
    if (leaks.length === 0) continue;
    // A gender the player picks has to disappear; a gender we know has to be
    // agreed with. Opposite repairs, so opposite prompts.
    if (!isPlayerGenderConflict(leaks)) {
      targets.push({
        kind: 'agreement',
        item,
        draft: row.translation,
        problem: genderAgreementInstruction(leaks),
      });
      continue;
    }
    // Hiding the speaker's gender and hiding the addressee's need different
    // moves, and on the corpus the addressee is 60 of every 69 such lines.
    const kind = leaks.some((leak) => leak.role === 'addressee') ? 'addressee' : 'speaker';
    targets.push({ kind, item, draft: row.translation, problem: genderRetryInstruction(leaks) });
  }

  return targets;
};

const buildRepairPayload = (opts: LlmTranslateOptions, targets: RepairTarget[]): object => ({
  task: 'uk_gender_repair',
  source_language: opts.srcLang,
  target_language: opts.targetLang,
  game: opts.game ?? null,
  items: targets.map(({ item, draft, problem }) => {
    const structured = compactLlmPartsFields(item.parts, item.slots);
    const translationParts =
      item.restoreSlots && item.restoreSlots.length > 0
        ? alignTextToSlots(draft, item.restoreSlots)
        : [draft];
    return {
      id: item.id,
      ...(structured.parts
        ? { ...structured, translation_parts: translationParts }
        : { source: item.source, translation: draft }),
      problem,
      ...compactLlmItemFields(item),
      ...participantPayloadFields(item),
    };
  }),
});

/** The rewordings offered for each line, in the order the model ranked them. */
const parseRepairItems = (raw: string, targets: RepairTarget[]): Map<number, string[]> => {
  const parsed = parseLlmJson(raw);
  const items = (parsed as { items?: unknown }).items;
  const byId = new Map<number, string[]>();
  if (!Array.isArray(items)) return byId;

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as {
      id?: unknown;
      variants?: unknown;
      translation?: unknown;
      parts?: unknown;
    };
    const id = parseLlmItemId(row.id);
    if (id == null) continue;
    const target = targets.find((candidate) => candidate.item.id === id);
    if (!target) continue;

    // A model that ignores the schema and answers with one `parts` array is
    // read as having offered one variant.
    const rawVariants = Array.isArray(row.variants) ? row.variants : [row.parts ?? row.translation];
    const variants: string[] = [];
    for (const variant of rawVariants) {
      const assembled = assembleTranslatedText(
        Array.isArray(variant) ? variant : undefined,
        typeof variant === 'string' ? variant : undefined,
        target.item.sourceParts,
        target.item.restoreSlots,
      );
      if (assembled != null && assembled.trim()) variants.push(assembled);
    }
    if (variants.length > 0) byId.set(id, variants);
  }
  return byId;
};

/**
 * Take, for each line, the first offered rewording that actually removed the
 * leak; a line none of them clears keeps its draft.
 */
export const mergeGenderRepair = (
  draft: LlmTranslateResult[],
  targets: RepairTarget[],
  repaired: Map<number, string[]>,
  targetLang: string,
): LlmTranslateResult[] => {
  const targetById = new Map(targets.map((target) => [target.item.id, target]));

  return draft.map((row) => {
    const variants = repaired.get(row.id);
    const target = targetById.get(row.id);
    if (!variants || !target) return row;
    const clean = variants.find(
      (next) =>
        next !== row.translation && findGenderLeaks(next, target.item, targetLang).length === 0,
    );
    return clean == null ? row : { id: row.id, translation: clean };
  });
};

const PROMPT_FOR_KIND: Record<RepairKind, string> = {
  speaker: UK_GENDER_SPEAKER_PROMPT,
  addressee: UK_GENDER_ADDRESSEE_PROMPT,
  agreement: UK_GENDER_AGREEMENT_PROMPT,
};

/** Ask one prompt about the lines it is the right prompt for. */
const repairOneKind = async (
  opts: LlmTranslateOptions,
  draft: LlmTranslateResult[],
  targets: RepairTarget[],
  kind: RepairKind,
): Promise<Map<number, string[]>> => {
  const empty = new Map<number, string[]>();
  if (targets.length === 0) return empty;

  try {
    const { content, meta } = await chatWithFallback({
      model: opts.model,
      // Agreement is one right answer; concealment has several, and the
      // detector, not the model, decides which of them holds.
      responseFormat: buildGenderRepairResponseFormat(
        targets.length,
        kind === 'agreement' ? 1 : GENDER_REPAIR_VARIANTS,
      ),
      signal: opts.signal,
      logMeta: {
        operation: `gender-${kind}`,
        context: {
          itemIds: targets.map((target) => target.item.id),
          itemCount: targets.length,
          game: opts.game ?? null,
        },
      },
      messages: [
        { role: 'system', content: PROMPT_FOR_KIND[kind] },
        { role: 'user', content: JSON.stringify(buildRepairPayload(opts, targets)) },
      ],
    });

    if (!content.trim() || meta.finishReason === 'length') {
      logLlm.warn(`gender ${kind} skipped: empty or truncated response`);
      return empty;
    }
    return parseRepairItems(content, targets);
  } catch (err) {
    logLlm.warn(`gender ${kind} failed; keeping the draft`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
};

/**
 * Re-ask for the lines whose gender the detector rejected.
 *
 * Two prompts, because the two failures want opposite repairs: a gender the
 * player picks has to disappear from the wording, while a gender we know has to
 * be agreed with. One prompt covering both told the model in the same breath
 * that «вирішив» did not match a female speaker and that it must not turn a
 * masculine form feminine — so Curie's own log came back as «Завершено
 * аналіз… помічником», the correct line rewritten into a wrong one.
 *
 * Splitting them also keeps each prompt short, which this model rewards:
 * measured on 60 real lines, every block of guidance added to the neutral
 * prompt raised the number of lines it handed back untouched.
 *
 * @returns The draft with repaired lines replaced; unchanged on any failure.
 */
export const repairGenderLeaks = async (
  opts: LlmTranslateOptions,
  draft: LlmTranslateResult[],
): Promise<LlmTranslateResult[]> => {
  if (draft.length === 0 || !isGenderGuardLanguage(opts.targetLang)) return draft;

  const targets = collectTargets(opts, draft);
  if (targets.length === 0) return draft;

  const kinds: RepairKind[] = ['speaker', 'addressee', 'agreement'];
  const byKind = kinds.map((kind) => targets.filter((target) => target.kind === kind));

  // One branch at a time. Fired together they treble the calls in flight for a
  // single batch, and the LLM pool is two wide — the queue then times them out.
  const answers = new Map<number, string[]>();
  for (const [index, kind] of kinds.entries()) {
    for (const [id, variants] of await repairOneKind(opts, draft, byKind[index]!, kind)) {
      answers.set(id, variants);
    }
  }
  if (answers.size === 0) return draft;

  const repaired = mergeGenderRepair(draft, targets, answers, opts.targetLang);
  let fixed = 0;
  let byLaterVariant = 0;
  for (const [i, row] of repaired.entries()) {
    if (row.translation === draft[i]?.translation) continue;
    fixed++;
    if ((answers.get(row.id)?.indexOf(row.translation) ?? 0) > 0) byLaterVariant++;
  }
  const shape = kinds.map((kind, index) => `${byKind[index]!.length} ${kind}`).join(', ');
  logLlm.info(
    `gender repair: ${fixed}/${targets.length} line(s) fixed, ${byLaterVariant} by a later variant (${shape})`,
  );
  return repaired;
};
