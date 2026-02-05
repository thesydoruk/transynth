# 13 — Dashboard

The Dashboard gives you a visual overview of translation progress across all mods.

---

## Table of Contents

- [Opening the Dashboard](#opening-the-dashboard)
- [Overall Progress](#overall-progress)
- [Progress by GRUP](#progress-by-grup)
- [QA Summary](#qa-summary)
- [Using Statistics to Plan Work](#using-statistics-to-plan-work)

---

## Opening the Dashboard

Navigate to **Dashboard** in the top navigation bar (route: `/dashboard`).

> TODO: Screenshot of the dashboard page.

---

## Overall Progress

The top section shows aggregate progress across all mods:

| Metric | Description |
|--------|-------------|
| **Total strings** | Number of all translatable strings imported |
| **Translated** | Strings with any translation (Draft, Approved, TM, Auto) |
| **Approved** | Strings explicitly approved by a translator |
| **Empty** | Strings with no translation yet |

> TODO: Describe the progress bar or pie chart.
> Confirm exact metric names from `DashboardPage.tsx`.

---

## Progress by GRUP

A breakdown table shows translation progress for each record type (GRUP):

| GRUP | Total | Translated | Approved | TM | Auto |
|------|-------|------------|----------|-----|------|
| DIAL | … | … | … | … | … |
| INFO | … | … | … | … | … |
| BOOK | … | … | … | … | … |
| … | … | … | … | … | … |

> TODO: Describe the GRUP progress table in more detail.
> Explain why some GRUPs have more strings than others (DIAL/INFO = dialogue).
> Add note about MCM and PEX signature rows if present.

---

## QA Summary

> TODO: Describe the QA summary section (if present on dashboard):
> - Count of QA issues by severity (Error / Warning / Info)
> - Most common issue types
> - Link to the editor filtered by QA issues

---

## Using Statistics to Plan Work

> TODO: Practical tips:
> - Sort GRUPs by "Empty" count descending to identify the biggest remaining
>   work areas.
> - High "TM" + low "Approved" counts mean there is a lot of easy review work.
> - High "Auto" counts mean LLM has run — prioritise QA on those strings.
> - Share dashboard screenshots with your team to show progress.

---

← [Special Editors](12-special-editors.md) | [Home](README.md) | **Next: [Coherence Checker →](14-coherence.md)**
