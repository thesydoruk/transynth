# 13 — Dashboard

The Dashboard gives you a visual overview of translation progress across all mods.

---

## Table of Contents

- [Opening the Dashboard](#opening-the-dashboard)
- [Overall Progress](#overall-progress)
- [Progress by GRUP](#progress-by-grup)
- [QA Summary](#qa-summary)
- [Using Statistics to Plan Work](#using-statistics-to-plan-work)
- [Health & Operations Panel](#health--operations-panel)

---

## Opening the Dashboard

Navigate to **Dashboard** in the top navigation bar (route: `/dashboard`).

---

## Overall Progress

The top section shows **four summary cards** with aggregate totals across
all mods:

| Card           | Description                                                                         |
| -------------- | ----------------------------------------------------------------------------------- |
| **Strings**    | Total number of translatable strings imported                                       |
| **Translated** | Strings that have any translation (any status except empty) — shown with percentage |
| **Approved**   | Strings with status `human` or `reviewed` — shown with percentage                   |
| **QA Issues**  | Count of active QA issues; red when > 0, green when 0                               |

Below the cards, each mod has a row in the **per-mod table** (see below).
A horizontal bar fills relative to translation completion. When a mod
reaches 100 % the bar turns green; otherwise it is blue.

If more than one mod is imported, a **totals footer row** summarises
all mods combined.

---

## Progress by GRUP

The per-mod table lists every imported mod with a column for each
translation status bucket:

| Column         | What is counted                             |
| -------------- | ------------------------------------------- |
| **Strings**    | Total source strings                        |
| **Translated** | All strings with any translation            |
| **%**          | Translated / Total as a percentage          |
| _(bar)_        | Visual progress bar (blue → green at 100 %) |
| **Approved**   | Status `human` + `reviewed` combined        |
| **Draft**      | Status `draft`                              |
| **TM**         | Status `tm` + `fuzzy` combined              |
| **Auto**       | Status `auto` / `auto_translated`           |
| **QA**         | Active QA issue count (red when > 0)        |

Click the **▸** expand toggle on any mod row to reveal the **GRUP
breakdown sub-table** for that mod. It shows the same metrics split by
record type (signature), so you can see at a glance which types have the
most remaining work.

The mod name in each row is a link that navigates directly to that
mod's editor.

**Why some GRUPs have more strings:**

- `DIAL` / `INFO` — dialogue records; typically the largest buckets in any narrative mod.
- `BOOK` — in-game readable books and notes.
- `NPC_` / `WEAP` / `ARMO` — name and description fields only; much smaller.
- `CONT` / `MISC` — container/item descriptions.
- `MCM` / `PEX` — MCM configuration and Papyrus script strings (if present);
  these appear when the mod includes interface or script text.

---

## QA Summary

Below the summary cards there is a **QA breakdown section** (shown only
when at least one active QA issue exists). It lists every issue type
that has at least one occurrence, with a mini horizontal bar chart and
an issue count:

| Issue type                | Colour |
| ------------------------- | ------ |
| `placeholder mismatch`    | Red    |
| `empty translation`       | Red    |
| `forbidden chars`         | Red    |
| `same as source`          | Orange |
| `length delta`            | Orange |
| `glossary violation`      | Orange |
| `duplicate inconsistency` | Teal   |

The bars are proportional to the total active issue count, making it
easy to see which issue type dominates.

In the per-mod table, the **QA** count is clickable when it is
greater than `0`. Clicking it opens that mod in the editor with the
**QA-only** filter enabled (`qaOnly=1`), so you can jump directly into
rows that have active QA issues.

---

## Using Statistics to Plan Work

- **Find the biggest remaining work areas:** expand a mod row to see
  the GRUP breakdown. The groups with the largest gap between "Strings"
  and "Translated" are where you should focus next.
- **High TM + low Approved = easy review work.** If the TM column is
  large but Approved is low, many strings have been auto-filled from the
  translation memory but not yet confirmed. Open the mod editor and
  filter `status=tm` to batch-review them quickly.
- **High Auto = LLM has run; prioritise QA.** LLM-translated strings
  (the Auto column) carry a higher risk of placeholder errors and
  glossary mismatches. After a batch translate run, check the QA column
  on the dashboard and drill into any red numbers.
- **Track milestone completeness.** The `%` column and the bar give you
  an at-a-glance milestone metric. Share a dashboard screenshot with your
  team to show progress without giving access to the tool itself.

---

## Health & Operations Panel

A separate **Health** page (route: `/ops`, nav link "Health") provides
real-time monitoring of the server and its background processes.

### System

Five cards at the top:

| Card          | Description                                             |
| ------------- | ------------------------------------------------------- |
| **Uptime**    | How long the server has been running (e.g. `2d 5h 12m`) |
| **Node.js**   | Runtime version (e.g. `v20.11.0`)                       |
| **Heap used** | V8 heap memory in use                                   |
| **RSS**       | Resident Set Size — total process memory                |
| **Database**  | Green "Connected" when DB is reachable, red otherwise   |

### Import Jobs

A table listing the **30 most recent** import jobs across all three
sources (EET, CSV, Mod), sorted newest-first. Each row shows:

- **Type** — badge: `EET`, `CSV` or `MOD`.
- **File** — the uploaded file name.
- **Status** — colour-coded badge (green = completed, blue = in progress,
  red = failed, orange = paused, dim = pending).
- **Progress** — `imported / total (%)` counter.
- **Error** — the `last_error` message when a job fails; "—" otherwise.
- **Updated** — timestamp of the last status change.

### LLM / Auto-translate

Two cards:

| Card                | Meaning                                        |
| ------------------- | ---------------------------------------------- |
| **Auto-translated** | Total translations produced by an LLM provider |

Below the cards, a **per-model breakdown** table shows how many
strings each model has produced (e.g. `openai:gpt-4o`, `vllm:Meta-Llama-3-8B-Instruct`).

### Database

One card with the **total database size** (e.g. `42 MB`), followed by a
table listing every core table with its estimated row count and disk
footprint. Useful for spotting unusually large tables or planning
backups.

The page auto-refreshes every 30 seconds.

---

← [Special Editors](12-special-editors.md) | [Home](README.md) | **Next: [Coherence Checker →](14-coherence.md)**
