# Контекст рядка з бази

Метадані й сусіди — з живої бази або API, не з дампів і не з лору "з пам'яті". Тут тільки
читання; запис — скілом `translation-apply`. Як дістатися до бази й API на прод-хості —
`CLAUDE.local.md`. Довгі SQL і скрипти передавай файлом через stdin: інлайнові лапки через
кілька оболонок ламаються.

## Моди

```sql
SELECT id, name FROM mods WHERE game = 'fo4' ORDER BY id;
```

## Знайти рядок

Діалог: `r.signature = 'INFO'` і `r.path_simplified IN ('INFO\NAM1', 'INFO\RNAM')`
(NAM1 — відповідь, RNAM — пункт колеса гравця). Порожній EN (`''`, `' '`) одразу відсікай.

| Є                     | Шукай                                                                             |
| --------------------- | --------------------------------------------------------------------------------- |
| `string_id`           | `strings.id` (= `translations.src_string_id`)                                     |
| цитата EN             | `s.text_raw ILIKE` серед модів FO4; кілька збігів — покажи квест/сцену, не вгадуй |
| FormID INFO           | `r.formid_hex`                                                                    |
| квест / сцена / топік | `dialog_quests.edid/name`, `dialog_scenes.edid`, `dialog_topics.edid`             |
| мовець                | `dialog_speakers.display_name` / `speaker_key`                                    |

## Картка рядка

```sql
SELECT s.id AS string_id, s.text_raw AS source, t.text AS uk, t.status, t.provenance,
       r.formid_hex, r.path_simplified, r.edid, m.id AS mod_id, m.name AS mod_name,
       CASE WHEN r.path_simplified = 'INFO\RNAM' THEN 'prompt' ELSE 'response' END AS kind,
       dt.id AS topic_id, dt.edid AS topic_edid, dt.quest_formid_hex,
       dq.edid AS quest_edid, dq.name AS quest_name,
       dn.speaker_key,
       COALESCE(nsp.gender_override, CASE WHEN nsp.is_player THEN 'any' END,
                nsp.detected_gender, 'unknown') AS speaker_gender,
       nsp.display_name AS speaker_display,
       dn.addressee_kind, nad.display_name AS addressee_name,
       COALESCE(nad.gender_override, CASE WHEN nad.is_player THEN 'any' END,
                nad.detected_gender, 'unknown') AS addressee_gender,
       ds.id AS scene_id, ds.edid AS scene_edid, ds.timing_sensitive
FROM strings s
JOIN records r ON r.id = s.record_id
JOIN mods m ON m.id = r.mod_id
LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
LEFT JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
LEFT JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = r.mod_id
LEFT JOIN dialog_quests dq ON dq.mod_id = dt.mod_id AND dq.formid_hex = dt.quest_formid_hex
LEFT JOIN dialog_speakers nsp ON nsp.mod_id = dt.mod_id AND nsp.speaker_key = dn.speaker_key
LEFT JOIN dialog_speakers nad ON nad.mod_id = dt.mod_id AND nad.speaker_key = dn.addressee_speaker_key
LEFT JOIN dialog_scene_phases dsp ON dsp.topic_id = dt.id
LEFT JOIN dialog_scenes ds ON ds.id = dsp.scene_id AND ds.mod_id = r.mod_id
WHERE s.id = $1 AND s.lang = 'en';
```

## Сусіди: transcript API

```
GET /api/dialogs/transcript?modId=MOD&scope=SCOPE&key=KEY&srcLang=en&targetLang=uk
GET /api/dialogs/groups?modId=MOD&scope=conversations&srcLang=en&targetLang=uk
```

Репліки вже стоять у порядку сцени / дерева топіка. Вибір `scope`:

1. є `scene_id` → `scope=scenes`, `key=scene_id`;
2. інакше є `quest_formid_hex` → `scope=conversations`, `key=quest_formid_hex`;
3. інакше → `scope=topics`, `key=topic_id`.

Один INFO буває в кількох сценах — бери ту, де стоїть цільовий рядок, або весь квест.
Немає графа (ні вузла, ні сцени) — не вигадуй квест: перекладай з мовця/адресата картки й
скажи, що сусідів немає.

## Як читати

- `kind=prompt` — колесо гравця: мовець — гравець (`any`), адресат — NPC вузла. Поле
  `speaker` вузла в API для промпту — це адресат. Промпт має той самий регістр, що й
  подальша репліка гравця.
- `kind=response` — говорить `speaker` з `speaker_gender`; `addressee_kind=player` — до
  гравця, навіть якщо `addressee_gender` порожній.
- Пара того самого INFO: RNAM + NAM1. Промпт не розжовуй до рівня NAM1.
- Варіанти фази (`variant_index` / `variant_count`) — умовні альтернативи тієї самої репліки,
  а не наступна репліка сюжету.
- Рід і "ти/ви" не переноси із сусідньої репліки, якщо мовець інший.
- Повторювані формули в межах сцени (так/ні, звертання, прізвиська) — однаково.
- Сенс омоніма (honey, ready, right, course) бери з репліки-відповіді, не з глосарія предметів.
- `strings.context` — підказка з Creation Kit, не заміна сцени. EDID (`MQ102…`, `COMCait…`,
  `DN039_OfficeTerminal…`) підказує, що це за запис, але сенс тримай від сусідів.

## Недіалогові записи

Шукай за `r.signature` / `r.path_simplified` (`NPC_\FULL`, `BOOK\DESC`, `TERM\…`, `QUST\…`,
`MESG\…`, `WEAP\FULL`…). Для серій предметів дивись сусідні записи тієї самої сигнатури з
подібним EN (`text_raw ILIKE '%Combat Armor%'`): серія має бути однаковою. Для записок —
рід автора з підпису чи сусідніх записів того самого EDID-префікса; не вигадуй.
