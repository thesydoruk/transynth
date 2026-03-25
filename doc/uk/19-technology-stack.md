# 19 — Технологічний стек

Ця сторінка описує основні технології, які використовуються у Fallout 4
Localization Pipeline, і пояснює роль кожної частини в системі.

---

## Огляд проєкту

Проєкт є full-stack платформою локалізації для файлів модів Bethesda. Він
поєднує TypeScript-бекенд, PostgreSQL для зберігання даних, React-вебінтерфейс
і набір CLI-процесів для імпорту, перекладу, рев'ю та експорту локалізаційних
даних.

На високому рівні система підтримує такі сценарії:

1. Імпорт ресурсів Fallout 4 і витяг локалізованих рядків.
2. Зберігання рядків, метаданих, пам'яті перекладів, глосаріїв і стану рев'ю в
   PostgreSQL.
3. Запуск перекладацьких workflow через translation memory, rule-based
   automation і LLM-провайдерів.
4. Рев'ю та редагування перекладів у web UI.
5. Експорт перекладених даних назад у сумісні з грою формати.

---

## Runtime і мова

- Основним runtime є Node.js.
- TypeScript використовується в backend, CLI та frontend-коді.
- Проєкт використовує ESM-модулі та строгий type checking.
- Bash, PowerShell і batch-скрипти застосовуються лише як допоміжні
  інструменти середовища там, де це потрібно.

---

## Backend і server-side застосунок

- Fastify використовується для HTTP-сервера та API-рівня.
- `pg` використовується для роботи з PostgreSQL.
- `@fastify/static`, `@fastify/cors` і `@fastify/multipart` забезпечують
  роздачу статики, доступ із браузера та завантаження файлів.
- CLI entry points у `src/cli/` керують workflow імпорту, перекладу, навчання,
  заміни та експорту.

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

- Ollama підтримується для локального LLM inference.
- OpenAI підтримується для хмарних workflow LLM-перекладу.
- Абстракції провайдерів лежать у `src/llm/`.

---

## Обробка файлів і форматів гри

- Власні TypeScript readers і writers у `src/bethesda/` обробляють формати ESP,
  EET, PEX, MCM, BA2, BSA та пов'язані зі STRINGS дані.
- `archiver`, `node-7z` і `7zip-bin` використовуються для створення та обробки
  архівів там, де це потрібно.
- `fast-xml-parser` використовується для XML-контенту.

---

## Tooling і quality

- ESLint використовується для linting.
- Prettier використовується для форматування.
- Jest використовується для unit tests.
- Тести лежать поруч із кодом у локальних папках `__tests__/` всередині `src/`.
- `tsx` використовується для прямого запуску TypeScript-файлів у development і
  CLI workflow.
- `concurrently` і `wait-on` використовуються в dev-orchestration scripts.

### UX baseline instrumentation

У репозиторії є lightweight benchmark-скрипт для фіксації baseline latency UX-критичних API у рамках roadmap.

- Скрипт: `scripts/uxBaseline.ts`
- Команда: `npm run ux:baseline -- --base-url http://localhost:3000 --samples 5 --warmup 1 --out logs/ux-baseline.json`
- Які ендпоінти міряються: dashboard stats, mods list, import jobs list, editor strings page, TM suggestions lookup.

Запускайте скрипт на працюючому сервері з репрезентативним набором даних, а згенерований JSON-звіт додавайте до оновлень roadmap.

### Спільні UI-компоненти

Багаторазові React-компоненти знаходяться в `web-ui/src/components/`. Кожен компонент має власну підтеку з реалізацією, SCSS Module та barrel-файлом `index.ts`.

Ключові спільні компоненти:

| Компонент | Шлях | Призначення |
|---|---|---|
| `PageHeader` | `components/PageHeader/` | Єдиний заголовок сторінки: назва, опис, слот для дій праворуч і опціональний рядок meta. Застосовано до GlossaryPage, ReviewQueuePage, ImportsPage та SettingsPage. |
| `StatusBadge` | `components/StatusBadge/` | Семантичний бейдж статусу у гридах рядків, картках coherence та рядках черги рецензування. |
| `OverflowMenu` | `components/OverflowMenu/` | Вторинні дії, згорнуті в меню `⋯` для компактних рядкових UI. |
| `ConfirmModal` | `components/ConfirmModal/` | Перевикористовуваний оверлей підтвердження небезпечних дій (замінює `window.confirm`). |

---

## Контейнеризація

- Docker і Docker Compose використовуються для локальної розробки та
  оркестрації сервісів.
- У репозиторії є кореневі `Dockerfile` і `docker-compose.yml`.

---

## Структура репозиторію

- `src/` - код бекенду, парсери форматів, CLI-workflow та спільна логіка.
- `web-ui/` - frontend-застосунок.
- `scripts/` - службові скрипти проєкту та bootstrap бази даних.
- `sql/` - SQL-схема та пов'язані з БД ресурси.
- `doc/` - консолідована документація проєкту.

---

← [Правила TradAuto](18-tradauto.md) | [Головна](README.md)
