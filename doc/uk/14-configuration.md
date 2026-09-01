# 14 — Конфігурація

Усі налаштування інструмента задаються через змінні середовища у файлі `.env`.
Частину активних налаштувань можна також переглянути в поточному режимі на сторінці **Налаштування** у веб-інтерфейсі.

---

## Зміст

- [Сторінка Налаштування (веб-інтерфейс)](#сторінка-налаштування-веб-інтерфейс)
- [Файл .env](#файл-env)
- [Налаштування бази даних](#налаштування-бази-даних)
- [Налаштування-llm-провайдера](#налаштування-llm-провайдера)
- [Налаштування сервера](#налаштування-сервера)
- [Feature flags](#feature-flags)
- [Docker-конфігурація](#docker-конфігурація)
- [Поради для production deployment](#поради-для-production-deployment)

---

## Сторінка Налаштування (веб-інтерфейс)

Сторінка **Налаштування** (`/settings`) надає централізований огляд усієї конфігурації проєкту.
Відкривається з іконки шестерні справа у верхній панелі.

Вкладки: **Загальні**, **LLM**, **Озвучка**, **Workflow**, **Правила QA**, **Активність**.
Глосарій на хабі гри, не у Налаштуваннях.

### Вкладка «Загальні»

Налаштування у цій вкладці зберігаються у `localStorage` браузера.
Вони не впливають на сервер, але попередньо заповнюють вибір мов на всіх сторінках
(Моди, Редактор, Узгодженість …).

| Налаштування        | Ключ localStorage    | За замовчуванням |
| ------------------- | -------------------- | ---------------- |
| Типова мова джерела | `transynth-src-lang` | `en`             |
| Цільова мова        | `transynth-tgt-lang` | `uk`             |
| Мова інтерфейсу     | `ui-lang`            | `uk`             |
| Тема                | `transynth-theme`    | `dark`           |

### Вкладка LLM

Пул серверів **vLLM** (хости, паралелізм, опційні ключі) редагується тут і
зберігається в `project_settings`. Провайдер і назви моделей лишаються з `.env`
і показані лише для читання. Ключ OpenAI у браузер не надсилається — лише факт,
що він заданий.

### Вкладка «Озвучка»

URL TTS-сервера — `TTS_BASE_URL` у `.env` (тут лише читання). **audio-intel**
(`AUDIO_INTEL_BASE_URL`) у UI немає: це Whisper для Disco spoken-span, окремо
від TTS. Паралелізм, режим line-reference і збіг таймінгу на гру зберігаються
в `project_settings`. Див. [Озвучка](09-voice.md).

### Вкладка Workflow

У `project_settings`: автопідтвердження при збереженні, поширення на ідентичні
рядки, ховати ignored за замовчуванням, QA (кінцева пунктуація / мін. слів),
`import.skip_tes4`, кількість і поріг RAG-прикладів, таймаути pipeline.
Тут також перебудова індексу RAG.

### Вкладка «Правила QA»

Вбудований редактор `qa_rules`. Маршруту `/qa-rules` немає.

### Вкладка «Активність»

Журнал дій оператора (імпорти, джоби, handoff). Фільтри й CSV-експорт — тут.
**Open full activity log** у Diff веде на цю вкладку. Маршруту `/activity` немає.

**Системний лог** — окрема сторінка з верхньої панелі (`/system-log`): рядки
LLM, TTS, job і system. Це не вкладка Settings.

---

## Файл .env

Скопіюйте `.env.example` у `.env` у корені проєкту й заповніть потрібні значення:

```bash
cp .env.example .env
```

Файл `.env` не комітиться в репозиторій.
Там, де це можливо, уже є дефолтні значення; явно задавати потрібно лише обов’язкові параметри.

```env
LLM_PROVIDER=vllm
LLM_FALLBACK=none

VLLM_BASE_URL=http://localhost:8000
VLLM_MODEL=meta-llama/Meta-Llama-3-8B-Instruct
# VLLM_API_KEY=
# Необов’язково: кілька однакових vLLM-серверів (JSON-масив). Ліміти на сервер замінюють LLM_MAX_PARALLEL.
# VLLM_SERVERS=[{"host":"http://localhost:8000","maxParallel":4,"apiKey":""},{"host":"http://localhost:8001","maxParallel":2,"apiKey":"secret"}]
# VLLM_EMBED_MODEL=

# OPENAI_API_KEY=sk-...
# OPENAI_TRANSLATE_MODEL=gpt-4.1-mini
# OPENAI_EMBED_MODEL=text-embedding-3-large

DATABASE_URL=postgresql://transynth:transynth@localhost:5433/transynth

BATCH_SIZE=30
LOG_LEVEL=info

# Необов’язкова стеля multipart у мегабайтах. Якщо не задано — практичної стелі немає.
# UPLOAD_MAX_FILE_SIZE_MB=10240

# LOG_DIR=./logs/
# DEBUG=1

# TTS_BASE_URL=http://localhost:8080
# AUDIO_INTEL_BASE_URL=http://localhost:8080
# AUDIO_INTEL_CACHE_DIR=./data/cache/audio-intel
```

---

## Налаштування бази даних

| Змінна         | За замовчуванням                                            | Опис                         |
| -------------- | ----------------------------------------------------------- | ---------------------------- |
| `DATABASE_URL` | `postgresql://transynth:transynth@localhost:5433/transynth` | PostgreSQL connection string |

Формат рядка підключення:

```text
postgresql://USERNAME:PASSWORD@HOST:PORT/DBNAME
```

Приклад:

```text
postgresql://transynth:transynth@localhost:5433/transynth
```

Якщо ви використовуєте **Docker Compose**, сервіси `web` і `cli` всередині контейнерної мережі отримують
`DATABASE_URL=postgresql://transynth:transynth@db:5432/transynth`.
У `.env` на хості залишайте URL з `localhost:5433` для локальних скриптів (`npm run db:init`, `scan:mods` тощо).

---

## Налаштування LLM-провайдера

| Змінна                       | За замовчуванням                          | Опис                                                         |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `LLM_PROVIDER`               | `vllm`                                    | Основний провайдер: `openai` або `vllm`                      |
| `LLM_FALLBACK`               | `none`                                    | Fallback: `none`, `openai` або `vllm`                        |
| `OPENAI_API_KEY`             | _(для OpenAI)_                            | Ваш OpenAI API key                                           |
| `OPENAI_TRANSLATE_MODEL`     | `gpt-4.1-mini`                            | Модель OpenAI для перекладу                                  |
| `OPENAI_EMBED_MODEL`         | `text-embedding-3-large`                  | Модель OpenAI для embeddings                                 |
| `VLLM_BASE_URL`              | `http://localhost:8000`                   | API endpoint vLLM (режим одного сервера)                     |
| `VLLM_SERVERS`               | _(опційно)_                               | JSON-масив chat-серверів: `[{host, maxParallel, apiKey}, …]` |
| `VLLM_API_KEY`               | _(опційно)_                               | API key, якщо сервер вимагає автентифікацію                  |
| `LLM_MAX_PARALLEL`           | `2`                                       | Макс. одночасних chat-запитів (лише один сервер)             |
| `VLLM_MODEL`                 | _(для vLLM)_                              | Назва моделі на inference-сервері                            |
| `VLLM_EMBED_BASE_URL`        | _(як чат)_                                | Окремий embedding-сервер; інакше `VLLM_BASE_URL`             |
| `VLLM_EMBED_MODEL`           | `Snowflake/snowflake-arctic-embed-l-v2.0` | Модель ембедів, коли є `VLLM_EMBED_BASE_URL`                 |
| `DOCKER_VLLM_BASE_URL`       | _(немає)_                                 | Чат для `web`/`worker` у Compose (`http://vllm-gemma:8000`)  |
| `DOCKER_VLLM_EMBED_BASE_URL` | _(немає)_                                 | Embed для контейнерів (`http://tei-embed:80`)                |

Температура, decay, max tokens, retry і HTTP timeout задаються в `.env`:
`LLM_TEMPERATURE` (типово `0.3`), `LLM_TEMPERATURE_DECAY`, `LLM_MAX_TOKENS`,
`LLM_MAX_ATTEMPTS` (типово `5`), `LLM_REQUEST_TIMEOUT_SEC`.

Якщо задано `VLLM_SERVERS`, chat-запити розподіляються між переліченими хостами.
Кожен запис містить `host`, `maxParallel` і `apiKey`. Загальна concurrency — сума лімітів серверів;
`LLM_MAX_PARALLEL` у цьому режимі ігнорується. Embeddings як і раніше йдуть на `VLLM_EMBED_BASE_URL`
або перший хост із списку.

---

## Налаштування сервера

| Змінна                    | За замовчуванням | Опис                                                                                                |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`           | HTTP-порт backend-сервера                                                                           |
| `HOST`                    | `127.0.0.1`      | Bind-address. Docker Compose ставить `0.0.0.0` у контейнері. Див. [SECURITY.md](../../SECURITY.md). |
| `UPLOAD_MAX_FILE_SIZE_MB` | не задано        | Необов’язкова стеля multipart у мегабайтах; якщо немає — практичної стелі немає                     |
| `WEB_PORT`                | як `PORT`        | Порт на хості в Docker Compose                                                                      |

`PORT` і `HOST` читаються з `process.env`, не з `CONFIG`. Vite проксіює `/api`
через `PORT`; змінної `VITE_API_BASE` немає.

Ще в `.env.example` (не дублюються в таблицях вище): `NEXUS_API_KEY`
(Discover / завантаження з Nexus), `REDIS_URL` (черга джоб; Compose ставить
`redis://redis:6379`), `TTS_BASE_URL` (Fish Speech), `DATA_DIR`,
`CHAMPOLLION_PATH` / `WINE_*` після `tools:install`, `AUDIO_INTEL_BASE_URL`
(Whisper для Disco, типово `http://localhost:8080`) і
`AUDIO_INTEL_CACHE_DIR` (типово `data/cache/audio-intel`). Повний список — у
прикладі.

---

## Feature flags

У поточній версії окремих feature flags немає.
Майже все ввімкнено завжди.

---

## Docker-конфігурація

Проєкт постачається з `docker-compose.yml` (web, worker, redis),
`docker/compose.db.yml` (Postgres, профіль `embedded-db`),
`docker/compose.vllm.yml` (Gemma, профіль `embedded-vllm`) і
`docker/compose.embed.yml` (Arctic embed, профіль `embedded-embed`).
Додайте профілі в `COMPOSE_PROFILES` і задайте `DOCKER_VLLM_*`, інакше
контейнери б’ють у `host.docker.internal:8000`. Як увімкнути:
[Початок роботи](01-getting-started.md#опційно-вбудовані-gemma-і-rag),
[LLM-переклад](06-llm-translation.md#вбудовані-vllm-і-embed).
Див. також [SECURITY.md](../../SECURITY.md).
Прод із зовнішнім пулом vLLM профілі моделей не ставить.

### Запуск стека

```bash
docker compose up -d
```

### Ініціалізація бази

```bash
docker compose run --rm web npm run db:init
```

### Повне очищення бази (лише для dev)

Щоб повністю стерти поточну базу і заново створити схему з `sql/schema.sql`,
використайте:

```bash
npm run db:reset -- --yes
```

Команда робить:

- `DROP SCHEMA public CASCADE`
- `CREATE SCHEMA public`
- повторну ініціалізацію схеми

Використовуйте цю команду тільки для dev-бази.

### Зупинка

```bash
docker compose down
```

### Збереження даних

Дані вбудованого Postgres лежать у `./data/postgres` на хості (див.
`docker/compose.db.yml`) і переживають `docker compose down`. Не запускайте
`docker compose down -v`, якщо не хочете їх стерти.

Резервне копіювання:

```bash
docker compose exec db pg_dump -U transynth transynth > backup_$(date +%Y%m%d).sql
```

Відновлення:

```bash
cat backup_20250101.sql | docker compose exec -T db psql -U transynth transynth
```

Щоб підключатися до бази з хоста через pgAdmin або DBeaver, використовуйте `localhost:5433` — порт уже проброшений у `docker/compose.db.yml`. Облікові дані беруться з `DATABASE_URL`.

---

## Поради для production deployment

Образ Compose `web` уже збирає React UI. Окремого Vite-сервісу в production немає.

1. **Зовнішній Postgres (типовий прод):** не ставте `COMPOSE_PROFILES` і
   `DOCKER_DATABASE_URL`. `DATABASE_URL` — на ваш сервер. Піднімайте лише
   `web`, `worker` і `redis`.
2. **Не перезаписуйте живий `.env`** файлом `.env.example`.
3. **Reverse proxy:** TLS перед `WEB_PORT`. Див. [SECURITY.md](../../SECURITY.md).
   Це застосунок для довіреної мережі — сирий порт у відкритий інтернет не ставте.
4. **Бекапи:** `pg_dump` зовнішньої бази (або `./data/postgres` для embedded
   профілю). Ніколи `docker compose down -v` на машині з даними перекладів.
5. **Деплой** — `git pull` і перезбірка образу `web`. `web` і `worker` ділять
   цей образ — перезапускайте обидва.

---

← [Перевірка узгодженості](13-coherence.md) | [Головна](README.md) | [Технологічний стек](15-technology-stack.md) →
