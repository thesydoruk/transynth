# 17 — Конфігурація

Усі налаштування інструмента задаються через змінні середовища у файлі `.env`.
Частину активних налаштувань можна також переглянути в поточному режимі на сторінці **Налаштування** у веб-інтерфейсі.

---

## Зміст

- [Сторінка Налаштування (веб-інтерфейс)](#сторінка-налаштування-веб-інтерфейс)
- [Файл .env](#файл-env)
- [Налаштування бази даних](#налаштування-бази-даних)
- [Налаштування-llm-провайдера](#налаштування-llm-провайдера)
- [Налаштування сервера](#налаштування-сервера)
- [Multi-user і auth](#multi-user-і-auth)
- [Feature flags](#feature-flags)
- [Docker-конфігурація](#docker-конфігурація)
- [Поради для production deployment](#поради-для-production-deployment)

---

## Сторінка Налаштування (веб-інтерфейс)

Сторінка **Налаштування** (`/settings`) надає централізований огляд усієї конфігурації проєкту.
Сторінку можна відкрити з посилання **Налаштування** у верхній панелі навігації.

Сторінка згрупована за проміжною taxonomy-моделлю:

| Група                        | Вкладки / surfaces                                    |
| ---------------------------- | ----------------------------------------------------- |
| **Конфігурація**             | **Загальні**, **LLM / Авто-переклад**, **Правила QA** |
| **Workflow tools**           | **TradAuto**, **TMX**, **Дані**                       |
| **Team operations**          | **Активність**                                        |
| **Лише для адміністраторів** | **Користувачі** _(лише в multi-user mode)_            |

Таке групування навмисне: TradAuto і TMX поки що залишаються всередині Settings,
але візуально відокремлені від конфігурації, бо це workflow-інструменти, а не
базові runtime-налаштування.

### Вкладка «Загальні»

Налаштування у цій вкладці зберігаються у `localStorage` браузера.
Вони не впливають на сервер, але попередньо заповнюють вибір мов на всіх сторінках
(Імпорт, Редактор, TMX, Узгодженість …).

| Налаштування        | Ключ localStorage | За замовчуванням |
| ------------------- | ----------------- | ---------------- |
| Типова мова джерела | `fo4-src-lang`    | `en`             |
| Цільова мова        | `fo4-tgt-lang`    | `uk`             |
| Мова інтерфейсу     | `ui-lang`         | `uk`             |
| Тема                | `fo4-theme`       | `dark`           |

### Вкладка LLM

Усі значення відображаються тільки для читання — вони надходять з змінних середовища.
Щоб змінити їх, відредагуйте `.env` і перезапустіть сервер.
API-ключ OpenAI ніколи не передається браузеру; показується лише факт його наявності.

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
# VLLM_EMBED_MODEL=

# OPENAI_API_KEY=sk-...
# OPENAI_TRANSLATE_MODEL=gpt-4.1-mini
# OPENAI_EMBED_MODEL=text-embedding-3-large

DATABASE_URL=postgresql://localizer:localizer@localhost:5432/localizer
POSTGRES_USER=localizer
POSTGRES_PASSWORD=localizer
POSTGRES_DB=localizer

BATCH_SIZE=30
LOG_LEVEL=info

# Максимальний розмір multipart upload у мегабайтах (за замовчуванням: 1024 MB = 1 GiB)
UPLOAD_MAX_FILE_SIZE_MB=1024

# LOG_DIR=./logs/
# MULTI_USER=true
# SESSION_LIFETIME_HOURS=72
# DEBUG=1
```

---

## Налаштування бази даних

| Змінна         | За замовчуванням | Опис                         |
| -------------- | ---------------- | ---------------------------- |
| `DATABASE_URL` | _(required)_     | PostgreSQL connection string |

Формат рядка підключення:

```text
postgresql://USERNAME:PASSWORD@HOST:PORT/DBNAME
```

Приклад:

```text
postgresql://localizer:localizer@localhost:5432/localizer
```

Якщо ви використовуєте **Docker Compose**, `DATABASE_URL` підставляється автоматично через ім’я сервісу `db`, тож зазвичай його не потрібно прописувати вручну для повного docker-стека.

---

## Налаштування LLM-провайдера

| Змінна                   | За замовчуванням         | Опис                                                   |
| ------------------------ | ------------------------ | ------------------------------------------------------ |
| `LLM_PROVIDER`           | `vllm`                   | Основний провайдер: `openai` або `vllm`                |
| `LLM_FALLBACK`           | `none`                   | Fallback: `none`, `openai` або `vllm`                  |
| `OPENAI_API_KEY`         | _(для OpenAI)_           | Ваш OpenAI API key                                     |
| `OPENAI_TRANSLATE_MODEL` | `gpt-4.1-mini`           | Модель OpenAI для перекладу                            |
| `OPENAI_EMBED_MODEL`     | `text-embedding-3-large` | Модель OpenAI для embeddings                           |
| `VLLM_BASE_URL`          | `http://localhost:8000`  | API endpoint vLLM / OpenAI-compatible сервера          |
| `VLLM_API_KEY`           | _(опційно)_              | API key, якщо сервер вимагає автентифікацію            |
| `VLLM_MODEL`             | _(для vLLM)_             | Назва моделі на inference-сервері                      |
| `VLLM_EMBED_MODEL`       | _(опційно)_              | Окрема embedding-модель; за замовчуванням `VLLM_MODEL` |

Поточна реалізація не дає конфігурувати через `.env` температуру, max tokens чи retry-count — backend використовує вбудовані defaults.

---

## Налаштування сервера

| Змінна                    | За замовчуванням        | Опис                                              |
| ------------------------- | ----------------------- | ------------------------------------------------- |
| `PORT`                    | `3000`                  | HTTP-порт backend-сервера                         |
| `HOST`                    | `0.0.0.0`               | Bind-address сервера                              |
| `UPLOAD_MAX_FILE_SIZE_MB` | `1024`                  | Максимальний розмір multipart upload у мегабайтах |
| `VITE_API_BASE`           | `http://localhost:3000` | API base URL для Vite dev server                  |

Ці значення читаються безпосередньо з `process.env` сервером і Vite dev server, а не через `CONFIG` у `src/config.ts`.

---

## Multi-user і auth

| Змінна                   | За замовчуванням | Опис                     |
| ------------------------ | ---------------- | ------------------------ |
| `MULTI_USER`             | `false`          | Увімкнути логін і RBAC   |
| `SESSION_LIFETIME_HOURS` | `72`             | Скільки годин живе сесія |

Сесії зберігаються як токени в базі даних.
JWT-secret у поточній архітектурі не використовується, `SESSION_SECRET` тут не потрібен.
Cookie завжди HTTP-only і `SameSite=Strict`.

---

## Feature flags

У поточній версії окремих feature flags немає.
Майже все ввімкнено завжди.

Єдиний реальний toggle — це **`MULTI_USER=true`**, який активує authentication і role-based access control.

---

## Docker-конфігурація

Проєкт постачається з `docker-compose.yml`, який підіймає:

- `backend` — Fastify API server;
- `frontend` — Vite dev server або статичну збірку;
- `db` — PostgreSQL.

### Запуск стека

```bash
docker compose up -d
```

### Ініціалізація бази

```bash
docker compose run --rm cli npm run db:init
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

Дані PostgreSQL зберігаються в docker volume `pgdata` і переживають звичайні `docker compose down` та перезапуски.

Резервне копіювання:

```bash
docker compose exec db pg_dump -U localizer localizer > backup_$(date +%Y%m%d).sql
```

Відновлення:

```bash
cat backup_20250101.sql | docker compose exec -T db psql -U localizer localizer
```

Щоб підключатися до бази з хоста через pgAdmin або DBeaver, додайте порт-мапінг `5432:5432` у `docker-compose.yml` або локальний override.

---

## Поради для production deployment

1. Створіть production override-файл для Docker Compose з жорстко зафіксованими версіями образів.
2. Зберіть frontend окремо через `web-ui` build і віддавайте його через nginx або Caddy.
3. Ставте reverse proxy перед backend-сервером на порту `3000` і завершуйте TLS на proxy-рівні.
4. У production обов’язково задайте сильний `DATABASE_URL`, увімкніть `MULTI_USER=true` і створіть іменовані акаунти.
5. Налаштуйте регулярний `pg_dump` для резервного копіювання.
6. Не запускайте `docker compose down -v` у production, якщо не хочете стерти всі дані перекладів.

Приклад nightly backup:

```bash
0 3 * * * docker compose -f /srv/app/docker-compose.yml exec -T db \
  pg_dump -U localizer localizer | gzip > /backups/f4loc_$(date +\%Y\%m\%d).sql.gz
```

---

← [Команда та користувачі](16-team-and-users.md) | [Головна](README.md) | [TradAuto](18-tradauto.md) →
