# UFO4P і синтез голосу: чому правки патчу не доходять до озвучення

Дата: 2026-10-21. Перевірка без змін у коді. База: `localizer` на `ai-pipeline`.

## Висновок

Так, підтверджено. Синтез для Fallout4.esm (mod 33) бере текст лише з рядків mod 33.
Unofficial Fallout 4 Patch імпортовано як окремий mod 116, і його перекриття (override)
INFO-записів ніде не зв'язані з базовою грою: ні на імпорті, ні в синтезі, ні в експорті.
Поняття «перекриття», «порядок завантаження» чи «переможець» для рядків у системі немає.

Наслідок подвійний:

1. Озвучення базової гри синтезується з тексту Fallout4.esm, хоча з UFO4P у грі
   показується текст патчу.
2. Переклад uk для mod 116 живе окремо і не збігається з відрецензованим перекладом
   бази. У грі субтитр візьметься з патченого `unofficial fallout 4 patch.esp`
   (переклад mod 116), а голос буде з перекладу mod 33. Субтитр і голос розійдуться.

## Обраний напрям (рішення користувача, 2026-10-21)

Для кожного мода і для базової гри синтезувати ту версію репліки, що відповідає перекладу
саме його версії тексту. Тобто пакет UFO4P має нести власні такі для перекритих реплік,
синтезовані з uk-тексту mod 116, і при встановленні поверх базового пакета перемагати
по шляху файлу.

Це узгоджується з механікою рушія, як її видно з самого UFO4P: він кладе свої голосові
файли під **ім'я плагіна-джерела запису**, а не під своє: `Sound/Voice/Fallout4.esm/…`,
`Sound/Voice/DLCRobot.esm/…`, `Sound/Voice/DLCCoast.esm/…`, `Sound/Voice/DLCNukaWorld.esm/…`
і лише один файл під `Sound/Voice/Unofficial Fallout 4 Patch.esp/` (єдиний власний
INFO-запис). Отже шлях така визначає FormID-джерело, а який пакет виграє, вирішує
порядок встановлення файлів.

## Як це влаштовано в коді

- Ключ запису: `records UNIQUE (mod_id, signature, path, formid_hex)`; `formid_hex`
  зберігається як сирий FormID з файлу (`src/formats/esp/EspReader.ts:272`).
  Перекриття від UFO4P має той самий `00xxxxxx`, що й Fallout4.esm, але інший `mod_id`,
  тому це просто другий незалежний запис зі своїми `strings` і `translations`.
  Для DLC сирий FormID **не збігається**: у DLCCoast.esm власні записи `01xxxxxx`,
  а в UFO4P те саме перекриття `03xxxxxx` (індекс майстра в списку MAST патчу).
  Порівнювати плагіни можна лише через (плагін-джерело за байтом індексу, нижні 6 hex).
- Синтез: `loadVoiceTranslations` (`src/voice/loadVoiceTranslations.ts:42`) робить
  `WHERE r.mod_id = $1`, ключ пошуку `<нижні 6 hex FormID>:<номер відповіді>`.
  Викликається з `localizeVoicePackage`, `synthesizeModVoiceLine`,
  `countCreationEngineVoiceWork` завжди для одного `modId`. Текст для TTS —
  `translations.text` для uk, без урахування статусу.
- Такі шукаються лише серед loose-файлів у `Sound/Voice/<ім'я файлу плагіна>/`
  (`src/voice/discoverVoiceFiles.ts:19-60`); BA2 розпаковуються на імпорті
  (`src/import/mod/extract.ts:68`). `voice_clips` заповнює `replaceVoiceClips`
  (`src/voice/persistBethesdaVoiceClips.ts:134`) на імпорті та при відкритті каталогу.
  Для UFO4P це дає 0 таків: його 401 файл лежить під іменами майстрів, а власна тека
  називається `Unofficial Fallout 4 Patch.esp` з великими літерами, тоді як файл плагіна —
  `unofficial fallout 4 patch.esp`; на Linux це теж промах.
- Референсне аудіо для синтезу береться лише з власного така мода
  (`synthesizeModVoiceLine.ts:101-117, 169`); без файлу — `line_not_found`.
  Такі майстра ніколи не читаються.
- Єдина майстер-свідома логіка, `src/voice/inheritedVoiceText.ts`
  (`findImportedMasterMods`, `lookupInheritedVoiceLine`), підставляє **текст** майстра
  для показу в прев'ю, і лише коли у дочірнього мода є власний файл така.
- Вихідний шлях синтезованого така дзеркалить `relPath` джерела
  (`src/voice/voiceFilePaths.ts:6`), пишеться в `_localize_{hash}/{lang}/`.
- Експорт: `exportPatchedEsp` (`src/web/export/exportEsp.ts:64`) теж per-mod;
  `espPatchPlan.ts` перекриття не знає. Рядки UFO4P inline (`lstring_id` null),
  тому він піде ESP-патчем зі своїм перекладом. Переможця по шляху файлу між пакетами
  обирає `src/web/export/langpackMerge.ts` за порядком Vortex.
- Згадок UFO4P у логіці немає; лише тестові фікстури в `src/vortex/__tests__/exportOrder.test.ts`
  і `src/nexus/__tests__/textUtils.test.ts`.

## Масштаб у базі (mod 116 проти 33/32/66/67/100/101/115, зіставлення за індексом майстра)

| Показник                                                           | Кількість                              |
| ------------------------------------------------------------------ | -------------------------------------- |
| INFO-записів у UFO4P                                               | 7 658 (усі перекриття, крім 2 власних) |
| реплік (рядків відповіді) INFO\NAM1, що мають пару в базі          | 9 105                                  |
| з них EN-текст змінено                                             | 6 097                                  |
| Fallout4.esm / DLCRobot / DLCCoast / DLCNukaWorld / DLCworkshop03  | 5 381 / 101 / 307 / 306 / 2            |
| змінених реплік із таком у базовому моді                           | 6 095                                  |
| змінених реплік, для яких UFO4P має власне аудіо                   | 108                                    |
| змінених реплік, для яких uk бази вже синтезовано                  | ~120                                   |
| uk mod 116 відрізняється від uk бази (EN змінено)                  | 4 963                                  |
| uk mod 116 відрізняється від uk бази (EN **не** змінено, дрейф TM) | 931                                    |
| uk збігається                                                      | 3 211                                  |
| нижні 6 hex, що збігаються між різними майстрами всередині mod 116 | 3                                      |

UFO4P постачає 346 унікальних ключів аудіо (401 файл); 215 з них не мають INFO-рядка в
mod 116 (аудіо-фікси без зміни тексту). Переклад mod 116 не входив у фінальний LQA
(провенанс `tm_fo4_final_review` лише в 1 361 рядку; решта `tm_auto_anchor` і `auto_generated`).

Приклади змін EN (база → UFO4P): «Oh, why do I even bother.» → «…bother?»;
«…al signs. Alert: Critical…» → «Alert: Critical signs... Alert: Critical signs.»;
«I'll keep out of trouble if he does.» → «I'll, uh, keep out of trouble if he does.».
Значна частка правок патчу приводить субтитр до того, що реально сказано в аудіо.

## Що потрібно для per-mod синтезу (не реалізовано)

1. **Ключ репліки з плагіном-джерелом.** Замість `<6 hex>:<n>` використовувати
   `<плагін-джерело>:<6 hex>:<n>`, де плагін-джерело = `MAST[байт індексу]` або власне
   ім'я, якщо індекс дорівнює кількості майстрів. Без цього у мода з кількома майстрами
   колізії (у UFO4P їх уже 3) і неможливо знайти так майстра.
2. **Пошук таків для перекриттів.** Для мода-патча сканувати всі теки `Sound/Voice/*/`
   у його дереві (власні фікси, 346 ключів), а для решти перекритих реплік брати як
   референс так майстра (`voice_clips` мода, чий `abs_path` збігається з іменем майстра,
   через уже наявний `findImportedMasterMods`). Порівняння імен тек робити без
   урахування регістру.
3. **Вибір реплік до синтезу.** Синтезувати для патча лише ті перекриті репліки, де його
   uk-текст відрізняється від uk-тексту майстра; решту пакет не несе, бо базовий пакет
   уже дає той самий звук. Сьогодні це 4 963 + 931 рядків.
4. **Вихідний шлях.** `Sound/Voice/<плагін-джерело>/<VoiceType>/<formid>_<n>.fuz`,
   тобто як у майстра; виходить природно, якщо референсом є так майстра, але писати треба
   в `_localize_` теку патча. Перевірити, що langpack патча включає ці файли і що
   `langpackMerge` віддає перемогу пакету патча за порядком Vortex.
5. **Переклад mod 116.** 931 реплік із незміненим EN, де uk розійшовся через TM, треба
   синхронізувати з відрецензованим uk бази, а не озвучувати. Для 6 097 змінених: де
   різниця лише в пунктуації, перенести uk бази з правкою; решту — окреме рев'ю, інакше
   пакет патча озвучить невідрецензований текст.
6. Так само для Vortex-синхронізації: якщо Vortex повторно імпортує UFO4P і гру, усе це
   має працювати на нових mod id.

## Невизначеності

- Код читали агенти, нічого не запускалось; імпорт UFO4P не повторювався.
- Порядок MAST у UFO4P прочитано з заголовка (Fallout4, DLCRobot, DLCworkshop01,
  DLCCoast, DLCworkshop02, DLCworkshop03, DLCNukaWorld, далі 9 CC .esl); власний індекс
  патчу 0x10. Зіставлення з DLC спирається на це припущення.
- Чи langpack пакує синтезовані такі з `_localize_` і як `langpackMerge` трактує
  однакові шляхи між базовим пакетом і пакетом патча, не перевірялось.
- Номери відповідей (TRDA) перечитуються з бінарника кожного плагіна окремо; для
  перекриттів вони мають збігатися з базою, але це не перевірялось.

## Реалізація (гілка `feature/patch-voice-origin`, 2026-10-21, не закомічено)

Виконано всі чотири етапи плану `~/.claude/plans/giggly-plotting-sunset.md`:

- **Origin у ключі.** `src/voice/voiceOrigin.ts`: резолвер «байт індексу FormID → MAST[idx] або власне ім'я»,
  `originFromVoiceRelPath`, `originFormidKey`. `voiceTranslationMapKey(lineKey, variant, origin)` →
  `<origin>/<FORMID6>:<variant>`; усі CE-мапи, `voice_synthesis_state` (нова колонка `origin_plugin` у PK),
  `voice_speaker_refs.origin_plugin`, `voice_clips.game_data.origin_plugin`, DNAM-аліаси, кеш референсів.
  `discoverVoiceFiles` сканує всі теки `Sound/Voice/*/`, `voiceSpeakerKey` бере спікера після будь-якого origin.
  Контракт: `voiceKeyFromRelPath(relPath)` замість `voiceKeyFromFileName`.
- **Master-backed такі.** `src/voice/voiceWorkList.ts`: `loadVoiceWorkList` (власні такі ∪ такі майстра для
  перекритих реплік, пропуск «same as master», зведені повідомлення в `skipped`) і `findMasterBackedTake`.
  Підключено до `localizeVoicePackage`, `countCreationEngineVoiceWork`, `listTakes`, каталогу редактора
  (`isInheritedAudio` + `inheritedFrom` для таких реплік) та одиночного синтезу (`originPlugin` у запиті).
- **Маршрути і UI.** `originPlugin` у query/body маршрутів audio / translation-audio / regenerate / speaker-ref,
  у live-подіях і в ключах рядків VoiceMode.
- **Експорт.** `orderVortexLangpackModIds(rows, order, mastersOf)`: мод іде після своїх майстрів і без порядку
  Vortex (`src/vortex/pluginMasters.ts` читає MAST). Allowlist експорту ключується з origin.

Тести: нові `voiceOrigin.test.ts`, `voiceWorkList.test.ts`, доповнені ~15 існуючих.
Не перевірено в реальному застосунку і в грі (кроки 2–7 розділу «Перевірка» плану).
