---
name: translation-apply
description: Write reviewed translation edits into the Transynth production database safely — guarded by the old text, with revisions, QA refresh and RAG/voice follow-up. Use only when the user explicitly asks to залити / записати / застосувати переклади чи правки в базу; never as an automatic next step after translating.
---

# Запис правок перекладу в базу

Запис у прод-БД — лише на пряму команду користувача в цій розмові. Переклад і рев'ю
(`fo4-uk-translate`) запису не передбачають.

## Формат правок

JSON-файл: список `{ "id", "old", "new", "note"? }` або об'єкт із таким списком під `fixes`
чи `ok` (файли батчів вичитки підходять як є).

- `id` — `strings.id` англійського рядка (= `translations.src_string_id`), не id перекладу.
- `old` — **точна** поточна українська з бази, прочитана щойно, не з пам'яті й не з давнього
  знімка; `""`, якщо перекладу ще нема.
- `new` — повний новий текст, не diff.
- `note` — навіщо (коди рев'ю: `gender`, `register`, `voice`…); піде в ревізію.

Збирай `old` зі свіжого SELECT безпосередньо перед записом. Файли пиши інструментом Write, а
не heredoc: оболонка псує бекслеші й лапки.

## Інструмент: `npm run translations:apply`

`scripts/applyTranslationFixes.ts` → `applyTranslationFixes` у `src/web/data/queries/`. Одна
транзакція: рядок записується, лише якщо в базі досі `old`; інакше він `stale` і не
чіпається. Для записаних — ревізія з provenance/model/note, оновлення QA-issues, видалення
застарілого RAG-прикладу, промоція в reference base (якщо ввімкнена в налаштуваннях). `«»`
складаються до `"…"`, як при кожному збереженні в редакторі.

```
npm run -s translations:apply -- <file> --dry-run
npm run -s translations:apply -- <file> --provenance agent_review --model <id моделі>
```

- `--status`: `reviewed` (типово), `human`, `draft`.
- `--provenance`: `agent_review` + `--model` для тексту, який написав агент і схвалив
  користувач; `human_edit` (типово) — коли текст продиктував користувач.
- Результат — JSON у stdout: `applied`, `unchanged`, `stale[]`, `rejected[]`.

Запуск на проді — у контейнері web (як дістатися — `CLAUDE.local.md`): скопіюй файл у
контейнер і запусти з `-w /app`. Поки цей код не задеплоєно (злиття в `main`), — через `_probe`
з `CLAUDE.local.md`.

## Порядок

1. Свіжий SELECT поточних перекладів → файл правок.
2. `--dry-run`; покажи користувачу підсумок (скільки запишеться, що stale чи rejected).
3. Справжній запуск.
4. `stale` — рядок змінився після читання: перечитай, переглянь правку, сформуй нову. Не
   перезаписуй силоміць.
5. `npm run rag:index-missing` — вбудувати нові тексти в RAG.
6. Голос: нічого вручну не стирати. Озвучений рядок зі зміненим текстом уже не «актуальний»
   (штамп версії тексту не збігається), і наступний voice-job зі `scope: missing` його
   переозвучить. Запускати job (GPU) — лише якщо користувач попросить:
   `POST /api/mods/<id>/voice-generate {"scope":"missing","targetLang":"uk"}`.

## Не робити

- Сирий `UPDATE translations` без перевірки старого тексту.
- Стирати `.fuz` / `voice_synthesis_state` руками або чистити голос усього мода.
- Чіпати інші мови або рядки з `is_ignored` (скрипт їх відхиляє).
- Писати рядки з порожнім EN.
- Міняти глосарій цим шляхом — це окрема таблиця `glossary` і seed у
  `src/games/creation-engine/data/glossary/`.
