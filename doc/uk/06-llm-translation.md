# 06 — LLM-переклад

Використовуйте AI для пакетного автоматичного перекладу рядків із підстановкою глосарію та захистом placeholders.

---

## Зміст

- [Огляд](#огляд)
- [Підтримувані провайдери](#підтримувані-провайдери)
  - [OpenAI](#openai)
  - [vLLM (локально)](#vllm-локально)
  - [Вбудовані vLLM і embed](#вбудовані-vllm-і-embed)
  - [Fallback chain](#fallback-chain)
- [Налаштування провайдера](#налаштування-провайдера)
- [Запуск пакетного перекладу](#запуск-пакетного-перекладу)
- [Verify, skip-detect і стать](#verify-skip-detect-і-стать)
- [Masking placeholders](#masking-placeholders)
- [Підстановка глосарію](#підстановка-глосарію)
- [Style guide](#style-guide)
- [Перевірка auto-перекладів](#перевірка-auto-перекладів)
- [Обмеження та best practices](#обмеження-та-best-practices)

---

## Огляд

Pipeline може надсилати пакети вихідних рядків у Large Language Model (LLM) і отримувати переклади назад як структурований JSON-масив.

Окремі системні промпти (і глосарії EN→UK) написані під **українську**. Інша цільова мова йде через загальний англійський промпт у `src/llm/prompts/en.ts`. Поки їх не узагальнять, продукт не є мовно-нейтральним.

LLM-переклад найкраще запускати **після TM waterfall** — тобто вже після того, як усі точні та близькі збіги безкоштовно заповнені через TM.
Рядки, перекладені моделлю, отримують статус **Auto**.

---

## Підтримувані провайдери

### OpenAI

Використовується OpenAI Chat Completion API.
Потрібен API key, а вартість залежить від кількості токенів.

Модель задається через `OPENAI_TRANSLATE_MODEL` (типове значення: **`gpt-4.1-mini`**).
Для вищої якості за вищу ціну можна використовувати `gpt-4o` або `gpt-4.1`.

Вартість залежить від моделі та розміру мода. Рядки йдуть пакетами (`BATCH_SIZE`, типово 30; у вебі ще стеля 100 рядків на запит). Якщо мод має 5 000 неперекладених рядків у середньому по 20 токенів, це грубо дає близько 100 000 вхідних і 100 000 вихідних токенів. Для `gpt-4.1-mini` це зазвичай лише кілька центів США, але актуальні ціни дивіться в OpenAI.

Рядки, уже знайдені в TM, не потребують нового LLM-запиту і не генерують додаткових витрат.

### vLLM (локально)

[vLLM](https://docs.vllm.ai/) та інші OpenAI-compatible inference-сервери (TGI, LiteLLM proxy тощо)
дають змогу запускати LLM локально на своїй машині або GPU-сервері.

Провайдер vLLM підключається до `VLLM_BASE_URL` (типово `http://localhost:8000`) через
стандартний OpenAI-compatible endpoint `/v1`. Будь-який сервер із `/v1/chat/completions`
і `/v1/embeddings` працює без окремої адаптації.

Приклад запуску vLLM:

```bash
vllm serve meta-llama/Meta-Llama-3-8B-Instruct --port 8000
```

У `.env`:

```env
LLM_PROVIDER=vllm
VLLM_BASE_URL=http://localhost:8000
VLLM_MODEL=meta-llama/Meta-Llama-3-8B-Instruct
```

Якщо сервер вимагає автентифікацію, задайте `VLLM_API_KEY`. Для окремого
embedding-сервера задайте `VLLM_EMBED_BASE_URL` і `VLLM_EMBED_MODEL`.

Орієнтовні вимоги до апаратури:

| Розмір моделі | Потрібно VRAM | Примітки                                      |
| ------------- | ------------- | --------------------------------------------- |
| 7B            | 6–8 GB        | Швидко на consumer GPU                        |
| 13B           | 10–12 GB      | Краща якість перекладу                        |
| 70B           | 40+ GB        | Якість близька до GPT-4, потрібен великий GPU |

Інференс на CPU можливий, але значно повільніший за GPU.
Для великих модів GPU-прорахунок практично обов’язковий.

### Вбудовані vLLM і embed

Репозиторій уже містить два Compose-оверлеї — той самий opt-in, що й
`embedded-db`. Профілі незалежні: можна підняти лише чат, лише RAG, або обидва.

| Профіль          | Файл                       | Сервіс       | На хості                   | З контейнерів `web` / `worker` |
| ---------------- | -------------------------- | ------------ | -------------------------- | ------------------------------ |
| `embedded-vllm`  | `docker/compose.vllm.yml`  | `vllm-gemma` | `http://localhost:8011/v1` | `http://vllm-gemma:8000`       |
| `embedded-embed` | `docker/compose.embed.yml` | `tei-embed`  | `http://localhost:8013`    | `http://tei-embed:80`          |

Чат — Gemma 4 26B A4B IT (AWQ), ім’я на сервері `gemma4:26b-a4b`. Ембедінги —
Snowflake `arctic-embed-l-v2.0` через Text Embeddings Inference. Потрібен
**NVIDIA Container Toolkit**. Перший старт качає десятки гігабайт у
`data/huggingface` і `data/vllm-gemma-4-26b-a4b`. Якщо вага Hugging Face
закрита — задайте `HF_TOKEN`.

У `.env` (поруч із `COMPOSE_PROFILES=embedded-db,embedded-vllm,embedded-embed`):

```env
LLM_PROVIDER=vllm
VLLM_BASE_URL=http://localhost:8011
VLLM_MODEL=gemma4:26b-a4b
VLLM_EMBED_BASE_URL=http://localhost:8013
VLLM_EMBED_MODEL=Snowflake/snowflake-arctic-embed-l-v2.0
DOCKER_VLLM_BASE_URL=http://vllm-gemma:8000
DOCKER_VLLM_EMBED_BASE_URL=http://tei-embed:80
```

`VLLM_*` — для процесів на хості (`npm run dev`, `curl`). `DOCKER_VLLM_*` —
те, що Compose підставляє в `web` / `worker` замість localhost (як
`DOCKER_DATABASE_URL` для Postgres). Без `DOCKER_*` контейнери шукатимуть
модель на `host.docker.internal:8000`.

```bash
docker compose up -d
```

Перший healthcheck у vLLM чекає до 5 хвилин, у TEI — довше. Перевірка:

```bash
curl -s http://localhost:8011/v1/models
curl -s http://localhost:8013/health
```

Перезапуск одного оверлею:

```bash
docker compose --profile embedded-vllm restart vllm-gemma
docker compose --profile embedded-embed restart tei-embed
```

**Settings → LLM.** Порожній пул серверів бере URL з `.env`. Якщо там уже
збережені хости (`localhost:8000` тощо), оверлей не підхопиться — або
очистіть список, або поставте `http://vllm-gemma:8000` (коли UI крутиться в
Compose) чи `http://localhost:8011` (коли API на хості).

Одна GPU на обидва сервіси: зменшіть `VLLM_GPU_MEMORY_UTILIZATION` (наприклад
`0.82`). Дві карти: `LLM_GPU_DEVICE=0` і `EMBED_GPU_DEVICE=1`. Blackwell:
`VLLM_OPENAI_IMAGE=vllm/vllm-openai:gemma4-0505-cu130`. Тег TEI: Ampere
`86-1.8`, Ada `89-1.8` (`TEI_IMAGE`).

Прод із зовнішнім пулом обидва профілі не ставить. Команди першого запуску —
у [Початку роботи](01-getting-started.md).

### Fallback chain

Якщо основний провайдер **недоступний**, pipeline автоматично спробує fallback-провайдера.

Fallback задається змінною `LLM_FALLBACK`:

```env
LLM_FALLBACK=openai
```

Дозволені значення: `openai`, `vllm`, `none`.

Fallback спрацьовує лише для **availability errors**:

- connection refused;
- DNS failures;
- timeouts;
- connection reset;
- HTTP 503.

Помилки rate limit (`429`) і автентифікації через fallback не повторюються — вони віддаються одразу.

На помилці **доступності** той самий attempt одразу пробує fallback. Якщо й він
падає, цикл повторює до `LLM_MAX_ATTEMPTS` (типово **5**) з exponential backoff
(`1s`, `2s`, `4s`, … плюс jitter, стеля `30s`).

---

## Налаштування провайдера

Усі LLM-параметри задаються через `.env`:

| Змінна                   | Значення за замовчуванням | Опис                                                    |
| ------------------------ | ------------------------- | ------------------------------------------------------- |
| `LLM_PROVIDER`           | `vllm`                    | Основний провайдер: `openai` або `vllm`                 |
| `LLM_FALLBACK`           | `none`                    | Fallback: `openai`, `vllm` або `none`                   |
| `OPENAI_API_KEY`         | _(порожньо)_              | Обов’язковий для `LLM_PROVIDER=openai`                  |
| `OPENAI_TRANSLATE_MODEL` | `gpt-4.1-mini`            | OpenAI-модель для перекладу                             |
| `OPENAI_EMBED_MODEL`     | `text-embedding-3-large`  | OpenAI-модель для embeddings                            |
| `VLLM_BASE_URL`          | `http://localhost:8000`   | Адреса vLLM / OpenAI-compatible сервера                 |
| `VLLM_API_KEY`           | _(порожньо)_              | Опційний API key, якщо сервер вимагає auth              |
| `VLLM_MODEL`             | _(порожньо)_              | Обов’язковий для `LLM_PROVIDER=vllm`                    |
| `VLLM_EMBED_MODEL`       | _(порожньо)_              | Окрема embedding-модель (за замовчуванням `VLLM_MODEL`) |
| `BATCH_SIZE`             | `30`                      | Рядків на LLM HTTP-batch (веб-джоби і CLI)              |

Повний перелік дивіться на сторінці [Конфігурація](14-configuration.md).

---

## Запуск пакетного перекладу

TM або LLM на весь мод — круглий контроль **Translate** (тулбар редактора і
список модів). Для підмножини рядків:

1. Відфільтруйте рядки, наприклад `Status = untranslated` і `GRUP = DIAL`.
2. Виберіть їх: чекбокси, `Space` на сфокусованому рядку, або `Ctrl+A` /
   checkbox у хедері для **усіх рядків за фільтром** (не одна сторінка).
3. У тулбарі з’являється **Auto-Translate N selected**. У context menu та сама
   LLM-дія плюс Apply TM. Окремих кнопок Approve / Reject для пакета немає.
4. Прогрес: **Translating X/Y**. Один запит — щонайбільше **100** рядків;
   великий «вибрати все за фільтром» ріжеться автоматично.
5. Готові рядки отримують статус **Auto**. Таблиця оновлюється між пакетами.

Web UI не підставляє style guide в batch translation.
Для стилістично керованого перекладу використовуйте CLI (`npm run translate`).

На вкладці Dialogs кнопки **Fill LLM** / **Fill TM** у шапці транскрипту б’ють
у ті самі ендпоінти для видимої групи.

---

## Verify, skip-detect і стать

Окремі джоби на тій самій смужці круглих контролів.

- **Verify** відкриває модалку (`llm-verify`). Опції: автопідтвердити рядки,
  які модель вважає чистими; автопідставити правки для підозрілих; чи брати
  вже підтверджені переклади. Результати лишаються в модалці, доки її не закриєте.
- **Skip-detect** позначає рядки, які не варто перекладати. Евристика дешева
  (same-as-source, порожнє, коди). **With LLM** додатково питає модель.
  Статус стає `skip`.
- **Gender-detect** (лише Bethesda) заповнює стать мовця / адресата для QA
  `gender_mismatch` і українських промптів. У Disco цього контролю немає.

Пропущені рядки не потрапляють у наступні проходи TM/LLM, доки їх не знімете зі skip.

---

## Masking placeholders

Ігрові рядки часто містять спеціальні токени, які не можна перекладати:

- `<Alias=Player>`, `<Alias=CompanionTarget>`;
- `[DIAL:001234AB]`;
- `\n`;
- `%s`, `%d`, `%1$s`;
- `{0}`, `{item}`;
- `$PlayerName`.

Pipeline **маскує** ці токени перед відправкою до LLM, замінюючи їх маркерами на кшталт `¤PH0¤`, `¤PH1¤`, а потім **розмасковує** у відповіді.

Це запобігає пошкодженню або перекладу placeholders.

| Тип токена                 | Приклад                                        |
| -------------------------- | ---------------------------------------------- |
| Printf specifiers          | `%s`, `%d`, `%1$s`                             |
| Numeric placeholders       | `{0}`, `{1}`                                   |
| Named placeholders         | `{item}`, `{PlayerName}`                       |
| Square-bracket refs        | `[DIAL:001234AB]`                              |
| Angle-bracket tags/aliases | `<Alias=Player>`, `<b>`, `<font color='#fff'>` |
| Dollar variables           | `$PlayerName`, `$CompanionTarget`              |

Приклад:

```text
Original: "<Alias=Player> received {0} caps from <Alias=NPC>."
Masked: "¤PH0¤ received ¤PH1¤ caps from ¤PH2¤."
→ LLM → "¤PH0¤ отримав ¤PH1¤ кришок від ¤PH2¤."
Restored: "<Alias=Player> отримав {0} кришок від <Alias=NPC>."
```

Для script-like рядків pipeline також маскує legacy `FunctionKeywords`
токени маркерами на кшталт `¤FK0¤`, щоб назви Papyrus-функцій і службові
ключові слова не перекладалися випадково.

У system prompt модель окремо інструктується **не змінювати `¤PH0¤`- і `¤FK0¤`-подібні токени**.

Практична примітка: web UI batch translate тепер теж застосовує protected-token masking перед викликом LLM. Глосарій, як і раніше, підставляється окремим блоком у system prompt.

---

## Підстановка глосарію

Pipeline вставляє **до 80 термінів** у web UI або **до 100 термінів** у CLI прямо в system prompt, щоб модель бачила бажані переклади ключових понять.

Приклад блоку в prompt:

```text
brotherhood of steel → Братство Сталі
synth → синт
```

Про керування термінами дивіться [Глосарій](08-glossary.md).

---

## Style guide

Можна передати Markdown-style guide, який описує тон, формальність, діалект і термінологічні правила.

Ця можливість доступна **лише в CLI translator** (`translateMod.ts`) через прапорець `--style`:

```bash
npm run translate -- --in export.csv --out translated.csv --style style.md
```

У запиті вміст style guide потрапляє в поле `style_guide` (перші 4 000 символів).
Web UI batch translate такої опції не має і використовує лише glossary injection.

Приклад style guide для української локалізації Fallout 4:

```markdown
# Translation Style Guide — Fallout 4 Ukrainian

## Tone

- Післяапокаліптичний світ: грубий, зношений, прагматичний тон.
- Голоси NPC відрізняються: від суворих військових до дружніх мешканців сховищ.
- Уникайте сучасного інтернет-сленгу та анахронізмів.

## Formality

- Використовуйте "ти" для компаньйонів і пересічних NPC.
- Використовуйте "ви" для фракційних лідерів і формальних quest givers.

## Dialect

- Стандартний сучасний український правопис.
- Уникайте русизмів.
- Коли природно, віддавайте перевагу питомим українським словам.

## Terminology

- Одиниці виміру `caps`, `rads`, `lbs` не конвертуйте.
- Назви фракцій перекладайте лише згідно з глосарієм.
- `Brotherhood of Steel` → `Братство Сталі` завжди.
```

---

## Перевірка auto-перекладів

Усі рядки, які переклала LLM-модель, отримують статус **Auto**.
Перед публікацією перекладу їх потрібно перевірити.

Рекомендований workflow:

1. Відфільтруйте `Status = Auto`.
2. Перевірте текст на змістові помилки, втрату placeholders і відповідність тону гри.
3. Після перевірки поставте статус **Reviewed** (контекстне меню / контроль
   статусу). **Human** — для імпортованих або підтверджених перекладів, не
   окрема кнопка Approve.

Для великих пакетів відфільтруйте редактор за **Status = Auto** або увімкніть
фільтр **Лише чернетки** в toolbar і працюйте з результатами прямо в редакторі.

---

## Обмеження та best practices

**Відомі обмеження:**

- Дуже довгі рядки, наприклад книги або термінальні нотатки, можуть перевищувати context window моделі.
- LLM інколи переставляє, дублює або втрачає `¤PH0¤` tokens, попри інструкції.
- Без глосарію модель нестабільно поводиться з proper nouns, назвами фракцій, іменами NPC та предметів.
- Локальні 7B-моделі дають помітно нижчу якість, ніж `gpt-4.1-mini`, особливо на складних діалогах.
- OpenAI може відповідати `429` на великих пакетах.
- CLI translator виконує batch-роботу блоками і чекає завершення кожного batch без streaming output.

**Рекомендована практика:**

1. Спочатку проганяйте TM, а вже потім LLM.
2. Заповнюйте глосарій до першого масового AI-перекладу.
3. Для великих проєктів використовуйте style guide через CLI.
4. Перекладайте через LLM лише `untranslated` рядки, не перетираючи наявні людські або TM-переклади.
5. Після кожного batch перевіряйте QA-помилки.
6. Перед релізом обов’язково пройдіться по всіх рядках зі статусом `auto`.

---

← [Пам’ять перекладів](05-translation-memory.md) | [Головна](README.md) | **Далі: [Контроль якості →](07-qa.md)**
