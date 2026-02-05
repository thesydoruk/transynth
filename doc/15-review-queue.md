# 15 — Review Queue

The Review Queue surfaces strings that need human attention —
especially low-confidence auto-translations.

---

## Table of Contents

- [What is the Review Queue?](#what-is-the-review-queue)
- [Opening the Review Queue](#opening-the-review-queue)
- [Filters](#filters)
- [Working Through the Queue](#working-through-the-queue)
- [Review Queue vs. Editor Filter](#review-queue-vs-editor-filter)

---

## What is the Review Queue?

The Review Queue is a focused view of strings that need a human decision.

It is most useful when:
- LLM batch translation has produced **Auto** strings and you need to verify them.
- TM-matched strings (**TM** status) need approval before export.
- A reviewer is checking another translator's work (**Draft** strings).
- You want to prioritise strings with the **lowest confidence scores** first.

---

## Opening the Review Queue

Navigate to **Review Queue** in the top navigation bar (route: `/review-queue`).

> TODO: Screenshot of the review queue page.

---

## Filters

The Review Queue supports several filters to focus your review effort:

| Filter | Description |
|--------|-------------|
| **Target language** | Show only strings for a specific language pair |
| **Status** | Filter by Auto / TM / Draft (or multiple) |
| **Mod** | Show only strings from a specific mod |
| **Max confidence** | Show only strings with confidence score ≤ threshold |
| **Page size** | Number of strings per page |

> TODO: Describe the confidence score concept in more detail.
> Explain where confidence scores come from (TM similarity score, LLM model output, etc.).
> Describe default filter values.

---

## Working Through the Queue

> TODO: Describe the review workflow:
> 1. Set filters (e.g. Status = Auto, Max confidence = 0.8).
> 2. The queue shows strings ordered by lowest confidence first.
> 3. For each string:
>    a. Read the source and translation.
>    b. If correct → click "Approve" (sets status to Approved).
>    c. If needs correction → click "Edit" to open in the editor, fix, approve.
>    d. If incorrect → click "Reset" to clear the translation and set status Empty.
> 4. Move on to the next string.
> Screenshot placeholder.

---

## Review Queue vs. Editor Filter

Both tools can show unreviewed strings.
The difference:

| | Review Queue | Editor Filter |
|---|-------------|---------------|
| **Scope** | All mods at once | One mod at a time |
| **Sorting** | By confidence (lowest first) | By any column |
| **Best for** | Quick batch review after LLM run | Deep editing of a single mod |

Use the **Review Queue** for a daily review pass after overnight LLM translation.
Use the **Editor Filter** when working deeply on a specific mod.

---

← [Coherence Checker](14-coherence.md) | [Home](README.md) | **Next: [Team & Users →](16-team-and-users.md)**
