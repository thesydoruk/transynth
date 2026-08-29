# 01 — Початок роботи

Запустіть Transynth на своїй машині вперше.

---

## Зміст

- [Вимоги](#вимоги)
- [Підтримувані ігри](#підтримувані-ігри)
- [Варіант A: Docker (рекомендовано)](#варіант-a-docker-рекомендовано)
  - [Опційно: вбудовані Gemma і RAG](#опційно-вбудовані-gemma-і-rag)
- [Варіант B: Локальний Node.js](#варіант-b-локальний-nodejs)
- [Перший запуск: створення бази даних](#перший-запуск-створення-бази-даних)
- [Відкриття Web UI](#відкриття-web-ui)
- [Наступні кроки](#наступні-кроки)

---

## Вимоги

- **Рекомендований шлях:** Docker Desktop з Docker Compose.
- **Локальний runtime:** практичний мінімум — Node.js 20+; Node.js 24 відповідає Docker-образу цього проєкту.
- **Менеджер пакетів:** npm (у репозиторії вже є `package.json` / `package-lock.json`; pnpm не потрібен).
- **База даних:** PostgreSQL 15+ для локального встановлення. Docker-стек використовує `pgvector/pgvector:pg17`.
- **Операційні системи:** Windows, macOS і Linux підходять для вебзастосунку. Якщо ви паралельно працюєте з інструментами для модингу Fallout, найпрактичніший хост — Windows.
- **Мова:** першокласні LLM-промпти й глосарії — англійська → українська. Інші цілі йдуть через загальний англійський промпт. UI за замовчуванням український. Це не мовно-нейтральна платформа.

## Підтримувані ігри

Transynth підтримує такі ігри:

- Fallout 4 (`fo4`)
- Fallout 76 (`fo76`)
- Fallout 3 (`fo3`)
- Fallout: New Vegas (`fnv`)
- The Elder Scrolls IV: Oblivion (`ob`)
- The Elder Scrolls III: Morrowind (`mw`)
- Skyrim Special Edition (`sse`)
- Skyrim Legendary Edition (`sle`)
- Disco Elysium Final Cut (`disco`)

Поведінка архівів/експорту залежить від профілю гри:

- FO4 / FO76: BA2-потік
- FO3 / FNV / OB / MW / SSE / SLE: BSA-потік
- Disco Elysium: мовні пакети Disco Translator Final Cut (`.po` + `.wav`)

### Disco Elysium (Final Cut)

Лоадер: [Disco Translator Final Cut](https://github.com/Gianxs/DiscoTranslatorFinalCut) (BepInEx il2cpp).

1. Встановіть BepInEx + Disco Translator Final Cut у папку гри.
2. У головному меню натисніть **c**, щоб вивантажити англійські `.po`, і **a** для референсних `.wav`.
3. Заархівуйте папку мови Final Cut і завантажте її в Transynth з грою `disco`.
4. Перекладіть у UI, за потреби синтезуйте голос.
5. Експортуйте langpack ZIP (`Ukrainian_Ukrainian_uk/*.po` + `Audio/*.wav`) і покладіть його поруч з іншими мовами Final Cut.

---

## Варіант A: Docker (рекомендовано)

Docker автоматично бере на себе Node.js, PostgreSQL і всі залежності.
Це найпростіший спосіб старту.

1. Встановіть Docker Desktop.
2. Клонуйте репозиторій.
3. Скопіюйте `.env.example` у `.env` у корені проєкту.
4. Перевірте параметри в `.env`.
   `.env.example` уже вмикає вбудовану базу:
   - `COMPOSE_PROFILES=embedded-db` — піднімає сервіс `db` з `docker/compose.db.yml`
   - `DATABASE_URL=…@localhost:5433/transynth` — команди на хості (`npm`, `psql`)
   - `DOCKER_DATABASE_URL=…@db:5432/transynth` — контейнери в мережі Compose
5. Якщо ви використовуєте **власний** vLLM, залиште `LLM_PROVIDER=vllm` і вкажіть у `VLLM_MODEL` модель сервера. Щоб підняти чат і/або RAG **у цьому Compose**, див. [оверлеї нижче](#опційно-вбудовані-gemma-і-rag).
6. Запустіть Postgres, Redis, API/UI і worker:

```bash
docker compose up -d
```

7. Ініціалізуйте схему бази даних:

```bash
docker compose run --rm web npm run db:init
```

8. Відкрийте `http://localhost:3000` у браузері.

Примітки:

- Сервіс `web` віддає і Fastify API, і зібраний React UI на порту `3000`.
- Імпорт, переклад і озвучка йдуть у **`worker`** через **Redis**.
  `docker compose up -d` піднімає обидва. `npm run dev` потребує доступний
  `REDIS_URL` (типово `redis://localhost:6379`), інакше джоби стоять.
- Ліпсинк / Champollion (джерело PEX у редакторі):
  `docker compose --profile tools run --rm cli npm run tools:install`.
  Одноразові команди `cli` потребують `--profile tools`.
- Щоб зупинити стек, виконайте `docker compose down`.

### Зовнішній Postgres

Не ставте `COMPOSE_PROFILES` і `DOCKER_DATABASE_URL`. Вкажіть `DATABASE_URL` на свій сервер і підніміть лише сервіси застосунку:

```bash
docker compose up -d web worker redis
docker compose run --rm web npm run db:init
```

### Опційно: вбудовані Gemma і RAG

Два профілі, як `embedded-db`: `embedded-vllm` (чат, `vllm-gemma`) і
`embedded-embed` (RAG, `tei-embed`). Можна ввімкнути один або обидва. Потрібен
NVIDIA Container Toolkit. Перший старт качає моделі в `data/huggingface` і
`data/vllm-gemma-4-26b-a4b`.

У `.env`:

```env
COMPOSE_PROFILES=embedded-db,embedded-vllm,embedded-embed
LLM_PROVIDER=vllm
VLLM_BASE_URL=http://localhost:8011
VLLM_MODEL=gemma4:26b-a4b
VLLM_EMBED_BASE_URL=http://localhost:8013
VLLM_EMBED_MODEL=Snowflake/snowflake-arctic-embed-l-v2.0
DOCKER_VLLM_BASE_URL=http://vllm-gemma:8000
DOCKER_VLLM_EMBED_BASE_URL=http://tei-embed:80
```

`DOCKER_VLLM_*` потрібні, коли `web` / `worker` у Compose: вони не бачать
`localhost` на хості. Далі звичайний `docker compose up -d` (профілі з
`COMPOSE_PROFILES` підхопляться самі). Healthcheck: `localhost:8011/v1/models`
і `localhost:8013/health`. Один сервіс пізніше:
`docker compose --profile embedded-vllm restart vllm-gemma`.

Прод із зовнішнім пулом обидва профілі не ставить. GPU, Settings → LLM і
Blackwell — у [LLM-переклад](06-llm-translation.md#вбудовані-vllm-і-embed).

---

## Варіант B: Локальний Node.js

Використовуйте цей варіант, якщо хочете запускати backend і frontend напряму.

1. Встановіть Node.js 20+ і PostgreSQL 15+.
2. Клонуйте репозиторій.
3. Встановіть backend-залежності:

```bash
npm install
```

4. Встановіть frontend-залежності:

```bash
npm --prefix web-ui install
```

5. Скопіюйте `.env.example` у `.env`. Для власного Postgres вкажіть `DATABASE_URL` і не ставте `COMPOSE_PROFILES` / `DOCKER_DATABASE_URL`. Щоб ходити в Compose-базу з хоста, залиште `DATABASE_URL=…@localhost:5433/transynth` і підніміть лише `db`: `docker compose --profile embedded-db up -d db`.
6. Створіть базу, якщо її ще немає, і ініціалізуйте схему:

```bash
npm run db:init
```

7. Запустіть API, worker і Vite UI разом (`npm run dev` **не** піднімає Postgres і Redis):

```bash
npm run dev
```

Фонові джоби потребують Redis (`REDIS_URL`, типово `redis://localhost:6379`). Або лише API: `npm run web:dev`, UI: `npm --prefix web-ui run dev`.

8. Відкрийте `http://localhost:5173` у браузері.

Vite проксіює `/api` на `http://localhost:3000`. API за замовчуванням слухає `HOST=127.0.0.1` — див. [SECURITY.md](../../SECURITY.md).

Щоб лише GPU крутився в Compose, а API — на хості: увімкніть профілі як вище,
підніміть `docker compose up -d vllm-gemma tei-embed` (або весь стек) і в `.env`
залиште `VLLM_BASE_URL=http://localhost:8011` без `DOCKER_VLLM_*`.

---

## Перший запуск: створення бази даних

Перед першим використанням схему бази даних потрібно ініціалізувати.
Це одноразова операція.

Запустіть одну з команд:

```bash
npm run db:init
```

або, через Docker:

```bash
docker compose run --rm web npm run db:init
```

Що це робить:

- Зчитує `sql/schema.sql` і застосовує його до бази з `DATABASE_URL` (або `DOCKER_DATABASE_URL` у Compose).
- Створює таблиці модів, рядків, перекладів, глосарію, імпорту, QA, журналу активності тощо.
- Додає один рядок у `users` (`id=1`, ім’я `Default`) для атрибуції в журналі. **Логіну немає**, колонки пароля і таблиці `sessions` теж немає.

Чого це не робить:

- Якщо `qa_rules` порожня, вставляє стартове правило `forbidden_chars` (`©®™`, warning) для кожної гри.
- Не скидає і не очищає базу.

Схема ідемпотентна. Після `git pull` зі змінами в `sql/schema.sql` знову запустіть `db:init`. Окремої папки міграцій поки немає. Вона все одно пише в ту базу, на яку вказує URL — перевірте ціль.

---

## Відкриття Web UI

Використовуйте URL, що відповідає вашому режиму запуску:

- **Docker:** `http://localhost:3000`
- **Локальний frontend dev server:** `http://localhost:5173`

**Логіну немає.** Хто дістався HTTP-порту — той користується застосунком. Див. [SECURITY.md](../../SECURITY.md).

Перший екран — каталог **ігор** (`/`). Поки сетап не завершено, там короткий чеклист: LLM, імпорт мода, автопереклад. Оберіть гру — відкриється хаб (`/games/:gameId`). Імпортовані моди: `/games/:gameId/mods`; редактор: `/games/:gameId/mods/:id`.

Верхня панель тонка: бренд (каталог ігор), badge останньої гри, пара мов контенту (`SRC → TGT`), Settings (шестірня) і **системний лог** (`/system-log` — рядки LLM / TTS / job / system). Glossary, Diff і Coherence живуть у хабі гри, не в першому рядку.

Картки хаба: Translate, Discover, **Quality** (це [узгодженість](13-coherence.md),
не QA-правила) і Terms. Правила QA — **Settings → QA**. Озвучка — посилання в
Settings → Voice. Якщо в грі вже є моди, одна панель Release веде Diff → експорт.

---

## Наступні кроки

- Імпортуйте свій перший мод → [Імпорт модів](02-importing-mods.md)
- Налаштуйте AI-переклад → [LLM-переклад](06-llm-translation.md)
- Налаштуйте змінні середовища → [Конфігурація](14-configuration.md)

---

← [Головна](README.md) | **Далі: [Імпорт модів →](02-importing-mods.md)**
