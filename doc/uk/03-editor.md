# 03 — Редактор

Редактор — це основний робочий простір для перевірки, виправлення та завершення перекладів.

---

## Зміст

- [Відкриття редактора](#відкриття-редактора)
- [Таблиця рядків](#таблиця-рядків)
  - [Колонки](#колонки)
  - [Пагінація](#пагінація)
  - [Сортування](#сортування)
- [Рядок фільтрів](#рядок-фільтрів)
- [Вибір і редагування рядків](#вибір-і-редагування-рядків)
- [Панель деталей](#панель-деталей)
  - [Текстові поля source і translation](#текстові-поля-source-і-translation)
  - [Вкладка TM Suggestions](#вкладка-tm-suggestions)
  - [Вкладка QA Issues](#вкладка-qa-issues)
  - [Вкладка Revision History](#вкладка-revision-history)
- [Бейджі статусів](#бейджі-статусів)
  - [Машина станів статусів](#машина-станів-статусів)
- [Пакетні дії](#пакетні-дії)
- [Search and Replace](#search-and-replace)
- [Контекстне меню](#контекстне-меню)

---

## Відкриття редактора

На сторінці **Mods** (`/`) натисніть на назву мода, щоб відкрити його редактор.
URL редактора: `/mods/:id`.

Якщо ви оновлюєте наявну версію мода, редактор також показує кнопку **Update**.
Вона завантажує новіший plugin або archive і перенаправляє вас у diff workflow, щойно новий import буде готовий.

---

## Таблиця рядків

Таблиця містить усі translatable strings мода — один рядок на один string.
Типово на сторінці показується 100 рядків.

### Колонки

| Колонка         | Опис                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| **Select**      | Checkbox для bulk-операцій на поточній сторінці                          |
| **GRUP**        | Signature типу запису (наприклад, `DIAL`, `BOOK`, `NPC_`, `QUST`)        |
| **FormID**      | Унікальний шістнадцятковий ідентифікатор запису                          |
| **EDID**        | Editor ID — внутрішня назва запису, яку задав автор                      |
| **Field**       | Назва sub-record field (наприклад, `FULL`, `DESC`, `NNAM`)               |
| **Source**      | Оригінальний англійський або базовий текст                               |
| **Translation** | Поточний найкращий переклад плюс маленька підказка з кількістю QA        |
| **Actions**     | Швидкі дії: approve, reject, clear, copy source і поточний бейдж статусу |

### Пагінація

У поточній реалізації пагінація фіксована на **100 рядків на сторінку**.

Внизу таблиці доступні:

- кнопка **Previous**
- кнопка **Next**
- підпис сторінки у форматі `Page X / Y (N rows)`

У UI зараз **немає вибору page size**.

Гарячі клавіші:

- **PgDn** переходить на наступну сторінку
- **PgUp** переходить на попередню сторінку

### Сортування

Сортуються такі заголовки:

- `GRUP`
- `FormID`
- `EDID`
- `Field`
- `Source`
- `Translation`

Повторний клік по тій самій колонці циклічно перемикає:

1. зростання
2. спадання
3. без сортування

Коли явне сортування не задано, сервер використовує fallback-сортування за record signature і path.

Колонки checkbox і Actions не сортуються.

Також усі data columns можна ресайзити, перетягуючи handle у header.

---

## Рядок фільтрів

Одразу під заголовками колонок є filter row.
Кожне поле фільтрує відповідну колонку під час введення.

| Фільтр      | Поведінка                                       |
| ----------- | ----------------------------------------------- |
| GRUP        | case-insensitive substring match                |
| FormID      | case-insensitive substring match                |
| EDID        | case-insensitive substring match                |
| Field       | case-insensitive substring match по record path |
| Source      | case-insensitive substring match                |
| Translation | case-insensitive substring match                |

Над таблицею toolbar також дає вищорівневі фільтри:

- selector **Source language**
- selector **Target language**
- dropdown **Status**
- поле **Global search** (`FormID / EDID / text…`)

Status dropdown зараз підтримує:

- `All statuses`
- `Untranslated`
- `Draft`
- `Reviewed`
- `Rejected`
- `Fuzzy`
- `Auto`
- `TM`
- `Human`

Поле global search шукає по source text, `FormID` і `EDID`.

Також є ліва панель signatures.
Клік по signature фільтрує таблицю до точного типу запису.

---

## Вибір і редагування рядків

- **Клік** по рядку вибирає його і відкриває панель деталей.
- **Клік** по checkbox додає або прибирає рядок із bulk selection.
- **Space** перемикає вибір для активного рядка.
- **Ctrl+A** вибирає або знімає вибір з усіх рядків поточної сторінки.

Важлива поправка: поточний редактор **не** підтримує inline-редагування прямо всередині grid cell.
Редагування відбувається в Detail Panel.

Поведінка збереження:

- Редагування поля translation запускає **800 ms autosave timer**.
- Перехід на інший рядок одразу flush-ить pending autosave.
- **Ctrl+S** зберігає вручну.
- **Ctrl+Enter** також зберігає з translation textarea.
- Якщо очистити translation field і зберегти, переклад видаляється, а рядок повертається в untranslated state.

Натисніть **Escape**, щоб закрити context menu, закрити detail panel або скинути selection — залежно від поточного стану UI.

---

## Панель деталей

Коли рядок вибрано, внизу сторінки з’являється Detail Panel.
Вона показує повний текст і три вкладки.

### Текстові поля source і translation

- **Source** — read-only, показує оригінальний текст.
- **Translation** — editable multi-line field.

Натисніть **Ctrl+S**, щоб зберегти поточний переклад.

Панель також показує:

- лічильник символів для source text
- лічильник символів для поточного translation draft
- швидкі кнопки **Copy src**, **Review**, **Reject** і **Save**

Якщо запис має тип `BOOK` або source містить HTML-подібну markup, панель показує кнопку **Book / HTML editor**.
Вона відкриває split-pane modal із raw markup з одного боку і live preview з іншого.

Поточний редактор **не** показує окреме max-length warning прямо в цій панелі.
Він також **не** підсвічує placeholders безпосередньо всередині textarea, хоча placeholder mismatch перевіряється через QA.

### Вкладка TM Suggestions

Вкладка Suggestions показує до **10** Translation Memory suggestion.

Кожен suggestion row містить:

- status badge
- badge методу match
- текст suggestion
- відсоток similarity
- кнопку **Apply**

Поточні match methods у UI:

- `exact`
- `punct_norm`
- `fuzzy`
- `segment`

Натискання **Apply** копіює suggestion у draft translation field.
Автоматичного збереження немає; далі працює стандартна логіка autosave/manual save.

Про загальний TM workflow дивіться [Пам’ять перекладів](05-translation-memory.md).

### Вкладка QA Issues

Показує будь-які QA-порушення для поточного рядка.
Кожна проблема має severity і message.

У поточному редакторі використовуються рівні **error** і **warning**.
Окремого рівня `info` зараз немає.

Приклади QA-checks, які реально генерує backend:

- **empty_translation**: переклад порожній
- **placeholder_mismatch**: набори placeholder token відрізняються між source і translation
- **same_as_source**: translation text ідентичний source
- **length_delta**: translation занадто сильно відрізняється за довжиною
- **forbidden_chars**: translation містить заборонені control chars або символи, заборонені конфігом
- **max_length**: translation перевищує конфігуроване max length для цього record type або path
- **glossary_violation**: source містить glossary term, але у перекладі немає потрібного варіанта
- **duplicate_inconsistency**: той самий normalized source text інакше перекладений в іншому місці

Про всю QA-систему дивіться [Контроль якості](07-qa.md).

### Вкладка Revision History

Вкладка History показує revision log для поточного рядка.

Кожен рядок містить:

- status badge
- timestamp
- optional note
- збережений snapshot тексту

Ця історія поповнюється під час save, status change і clear.

Поточний UI **не** показує імена авторів у списку history.
Також тут **немає** one-click restore з історії.

---

## Бейджі статусів

Кожен рядок має статус, який описує стан його перекладу:

| Статус                 | Значення                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| **Untranslated**       | Перекладу ще немає                                                         |
| **Draft**              | Переклад введений людиною, але ще не перевірений                           |
| **Reviewed**           | Переклад вручну перевірений і підтверджений у редакторі                    |
| **Approved** (`human`) | Імпортований або іншим чином позначений як підтверджений людський переклад |
| **TM**                 | Автоматично підставлений із Translation Memory                             |
| **Fuzzy**              | Підставлений через fuzzy TM-style match                                    |
| **Auto**               | Автоматично перекладений LLM                                               |
| **Rejected**           | Явно позначений як rejected                                                |

Як статуси змінюються зараз:

- Збереження вручну введеного перекладу створює або оновлює **Draft**.
- Дії **Review / Approve** ставлять статус `reviewed`.
- **Reject** ставить `rejected`.
- **Apply TM** створює `tm` або `fuzzy` залежно від типу збігу.
- Batch auto-translate створює `auto`.
- Clear видаляє translation і повертає рядок у `untranslated`.

### Машина станів статусів

Кожна зміна статусу перевіряється формальною машиною станів (`src/web/statusMachine.ts`).
Не кожен актор може перевести переклад у будь-який статус — правила такі:

| З (поточний)                                        | В (новий)  | Хто може                       |
| --------------------------------------------------- | ---------- | ------------------------------ |
| _(немає / будь-який)_                               | `draft`    | translator, reviewer, admin    |
| _(будь-який)_                                       | `tm`       | лише system (TM engine)        |
| _(будь-який)_                                       | `fuzzy`    | лише system (TM engine)        |
| _(будь-який)_                                       | `auto`     | лише system (LLM batch)        |
| _(будь-який)_                                       | `human`    | лише system (EET / CSV import) |
| `draft`, `tm`, `fuzzy`, `auto`, `human`             | `reviewed` | reviewer, admin                |
| `draft`, `tm`, `fuzzy`, `auto`, `human`, `reviewed` | `rejected` | reviewer, admin                |

Ключові правила:

- **Перекладач не може затвердити** власну роботу — він може лише зберігати draft.
- **Reviewer може approve або reject** будь-який не-deleted переклад.
- **Відхилені рядки** можна повернути в роботу: збережіть новий текст (→ `draft`) і потім знову схваліть.
- **System-актор** (автоматичні pipeline-и) не обмежений жодними правилами.

UI-ендпоінт `GET /api/strings/status-transitions?from=<status>` повертає список
досяжних статусів для поточного користувача — редактор використовує його, щоб
вмикати або вимикати кнопки Approve / Reject.

Де можна змінити статус:

- quick action buttons у grid
- кнопки в detail panel
- context menu
- гарячі клавіші на кшталт `Ctrl+Shift+A` і `Ctrl+Shift+R`
- bulk approve/reject actions для selected rows

Кольори бейджів у поточному UI:

- **Reviewed / Approved**: зелений
- **Draft**: світло-зелений
- **Rejected**: червоний
- **TM**: синій
- **Fuzzy**: блакитний
- **Auto**: помаранчевий
- **Untranslated**: сірий

Окрім самого бейджа, фон рядка таблиці також тонується за статусом:

- untranslated rows мають оранжево-коричневий фон
- draft rows — темно-зелений
- rejected rows — темно-червоний
- TM і auto rows — темно-бірюзовий
- fuzzy rows — темно-бурштиновий
- reviewed і approved rows використовують звичайний фон

---

## Пакетні дії

Ви можете вибрати кілька рядків і застосувати одну дію до них одразу.

Як працює selection зараз:

- використовуйте row checkboxes
- використовуйте **Space** на активному рядку
- використовуйте **Ctrl+A**, щоб вибрати або зняти вибір з усіх рядків поточної сторінки

Поточний UI **не** реалізує Shift+Click range selection.

Доступні batch actions:

- **Auto-translate N**: надсилає selected rows у LLM batch translation endpoint
- **Approve N**: позначає selected translations як reviewed
- **Reject N**: позначає selected translations як rejected
- **Copy source → translation** для всіх selected rows через context menu

Batch actions з’являються в toolbar, коли вибрано хоча б один рядок.
Додаткові bulk actions з’являються в context menu, якщо серед обраних є той рядок, на якому ви зробили right-click.

Поточне обмеження: у редакторі немає окремої bulk-дії **скопіювати найкращу TM suggestion у всі selected rows**.

---

## Search and Replace

Використовуйте кнопку **Search & Replace** у toolbar, щоб відкрити діалог.

Важлива поправка: поточний редактор **не** визначає shortcut `Ctrl+H` для цього діалогу.

Діалог зараз підтримує:

- рядок **Search**
- рядок **Replace with**
- checkbox **Use regex**
- кнопку **Preview** для dry-run mode
- кнопку **Apply** для виконання заміни

Поведінка preview:

- backend запускається в `dryRun=true` mode
- у label кнопки Preview показується кількість збігів
- preview list показує до перших 20 matches
- кожен preview row містить `FormID`, old text snippet і new text snippet

Scope у поточній реалізації:

- **лише поточний мод**
- **лише поточна target language**

Окремого selector-а scope для поточного фільтра, сторінки або всіх модів зараз немає.

---

## Контекстне меню

Зробіть right-click по будь-якому рядку, щоб відкрити context menu.

Поточне context menu включає такі дії, залежно від стану рядка:

- **Approve**: позначити рядок як reviewed
- **Reject**: позначити рядок як rejected
- **Clear translation**: видалити поточний переклад
- **Copy source → translation**: скопіювати source text у translation field

Якщо рядок уже має translation, меню також показує text utilities:

- **UPPERCASE**
- **lowercase**
- **Capitalize first letter**
- **Trim whitespace**

Якщо вибрано кілька рядків і рядок, по якому зроблено right-click, входить до selection, меню також показує bulk actions:

- **Approve N rows**
- **Reject N rows**
- **Auto-translate N rows**
- **Copy source → translation (N)**

Поточне context menu **не** містить дій на кшталт **Apply TM**, **Copy FormID**, **Open in INNR editor** або **Reset to Empty** саме під такими назвами.

---

← [Імпорт модів](02-importing-mods.md) | [Головна](README.md) | **Далі: [Гарячі клавіші →](04-keyboard-shortcuts.md)**
