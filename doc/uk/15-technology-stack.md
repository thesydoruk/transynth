# 15 — Технологічний стек

Ця сторінка описує основні технології Transynth і роль кожної частини в системі.

---

## Огляд проєкту

Проєкт є full-stack платформою локалізації модів Bethesda (і Disco Elysium).
Він поєднує TypeScript-бекенд, BullMQ worker, PostgreSQL, React UI і npm-скрипти
для імпорту, перекладу, рев’ю та експорту.

На високому рівні система підтримує такі сценарії:

1. Імпорт ресурсів мода і витяг локалізованих рядків.
2. Зберігання рядків, метаданих, пам'яті перекладів, глосаріїв і стану рев'ю в
   PostgreSQL.
3. Запуск перекладацьких workflow через translation memory, rule-based
   automation і LLM-провайдерів.
4. Рев'ю та редагування перекладів у web UI.
5. Експорт перекладених даних назад у сумісні з грою формати.

---

## Runtime і мова

- Основним runtime є Node.js.
- TypeScript використовується в backend, worker і frontend-коді.
- Проєкт використовує ESM-модулі та строгий type checking.
- Bash, PowerShell і batch-скрипти застосовуються лише як допоміжні
  інструменти середовища там, де це потрібно.

---

## Backend і server-side застосунок

- Fastify використовується для HTTP-сервера та API-рівня.
- `pg` використовується для роботи з PostgreSQL.
- `@fastify/static`, `@fastify/cors` і `@fastify/multipart` забезпечують
  роздачу статики, доступ із браузера та завантаження файлів.
- Імпорт, переклад і експорт ідуть як HTTP-джоби (BullMQ worker) або
  `npm run` у `scripts/`. Дерева `src/cli/` немає.

---

## Frontend

- React використовується для вебінтерфейсу.
- Vite використовується для розробки та production-build frontend-частини.
- TypeScript використовується і у frontend.
- SCSS Modules застосовуються для локалізованих стилів компонентів.
- Токени теми централізовані в `web-ui/src/index.scss`.

---

## База даних

- PostgreSQL зберігає дані проєкту, рядки, метадані, QA-стан, review queues,
  записи глосарію та пам'ять перекладів.
- SQL-схема лежить у `sql/`.
- Ініціалізація бази даних виконується через `scripts/dbInit.ts`.

---

## AI та сервіси перекладу

- vLLM (або інший OpenAI-compatible сервер) підтримується для локального LLM inference.
- OpenAI підтримується для хмарних workflow LLM-перекладу.
- Абстракції провайдерів лежать у `src/llm/`.

---

## Обробка файлів і форматів гри

- Власні TypeScript readers і writers у `src/formats/` (`ba2/`, `bsa/`, `esp/`, …) обробляють формати ESP,
  EET, PEX, MCM, BA2, BSA та пов'язані зі STRINGS дані.
- `archiver` і `node-7z` обробляють архіви. Обидва пакети лишаються: `7zip-bin`
  (`7za`, zip/7z) і `7z-bin` (повний `7z`, RAR) — `7za` не розпаковує RAR.
- `fast-xml-parser` використовується для XML-контенту.

---

## Tooling і quality

- Кореневий Jest покриває `src/` і `worker/`. У `web-ui` — Vitest (`*.test.ts` / `*.test.tsx`).
- Тести лежать поруч із кодом у `__tests__/` або як `*.test.ts(x)` біля джерела.
- `tsx` використовується для прямого запуску TypeScript-файлів у development і
  CLI workflow.
- `concurrently` і `wait-on` використовуються в dev-orchestration scripts.

### Спільні UI-компоненти

Багаторазові React-компоненти знаходяться в `web-ui/src/components/`. Кожен компонент має власну підтеку з реалізацією, SCSS Module та barrel-файлом `index.ts`.

Ключові спільні компоненти:

| Компонент      | Шлях                       | Призначення                                                                                                                                           |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`   | `components/PageHeader/`   | Єдиний заголовок сторінки: назва, опис, слот для дій праворуч і опціональний рядок meta. Використовується на Glossary, Settings і подібних сторінках. |
| `StatusBadge`  | `components/StatusBadge/`  | Семантичний бейдж статусу у гридах рядків і картках coherence.                                                                                        |
| `OverflowMenu` | `components/OverflowMenu/` | Вторинні дії, згорнуті в меню `⋯` для компактних рядкових UI.                                                                                         |
| `ConfirmModal` | `components/ConfirmModal/` | Перевикористовуваний оверлей підтвердження небезпечних дій (замінює `window.confirm`).                                                                |

---

## Контейнеризація

- Docker і Docker Compose використовуються для локальної розробки та
  оркестрації сервісів.
- У репозиторії є `docker/Dockerfile` і кореневий `docker-compose.yml`.
- Опційні оверлеї: `docker/compose.db.yml` (`embedded-db`),
  `docker/compose.vllm.yml` (`embedded-vllm`), `docker/compose.embed.yml`
  (`embedded-embed`).

---

## Структура репозиторію

- `src/` - код бекенду, парсери форматів, CLI-workflow та спільна логіка.
- `web-ui/` - frontend-застосунок.
- `scripts/` - службові скрипти проєкту та bootstrap бази даних.
- `sql/` - SQL-схема та пов'язані з БД ресурси.
- `docker/` - збірка образу та опційні Compose-оверлеї (Postgres, Gemma, RAG).
- `doc/` - консолідована документація проєкту.

---

← [Конфігурація](14-configuration.md) | [Головна](README.md)
