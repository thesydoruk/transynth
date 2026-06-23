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

If the queue is empty, the page provides immediate next actions instead of showing only passive text:

- **Restore review statuses** when all status chips were disabled
- **Reset filters** when the queue is empty because of the current filter combination
- **Open current game hub** (or the games catalogue if no game context is stored)
- **Open Activity log** (when filters are active) for handoff and audit checks

---

## Filters

The Review Queue supports several filters to focus your review effort:

| Filter              | Description                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Target language** | Language to review: uk / ru / de / fr / pl. Default: **uk**.                                |
| **Status**          | Toggle chips: **Auto**, **Fuzzy**, **TM**, **Draft**. All four are on by default.           |
| **Mod**             | Restrict to a single mod, or **All Mods** (default).                                        |
| **Max confidence**  | Show only strings below a threshold: All / <0.95 / <0.85 / <0.75 / <0.60. Default: **All**. |

The table always shows **50 strings per page**, sorted by confidence ascending — the strings
you are least certain about appear first.

### Confidence Scores

Every string in the queue carries a **confidence score** (0–1) displayed as a mini horizontal
bar with a percentage:

| Score source         | How it is assigned                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| **Fuzzy / TM match** | Normalised text-similarity score from the TM lookup (1.0 = exact match; lower = less similar). |
| **Auto (LLM)**       | Confidence value returned by the LLM provider alongside the translation.                       |
| **Unknown**          | Displayed as `—`; sorted to the bottom of the queue.                                           |

A score closer to **0** means the translation was uncertain and needs close inspection.
A score of **1.0** (100 %) typically indicates an exact TM hit and rarely needs correction.

---

## Working Through the Queue

1. **Set filters** — choose the target language, enable only the statuses you want
   (e.g. **Auto** only after a fresh LLM run), and optionally set **Max confidence** to
   `< 0.85` to focus on the strings the LLM was least sure about.

2. A row counter in the toolbar shows how many strings match your current filters.

3. **For each row in the table:**

   | Column      | What to check                                 |
   | ----------- | --------------------------------------------- |
   | Mod         | Which mod the string belongs to               |
   | GRUP        | Record group (e.g. DIAL, BOOK, WEAP)          |
   | EDID        | Editor ID — click to open in the Mod Editor   |
   | Source (EN) | The original English text                     |
   | Translation | The auto-generated or TM-matched translation  |
   | Status      | Auto / Fuzzy / TM / Draft                     |
   | Conf        | Confidence bar — low % needs close inspection |
   | QA          | Any active QA warnings on this string         |

4. **Take action per string:**
   - **Approve** — sets the status to `reviewed`. The row disappears from the queue.
     QA checks re-run automatically in the background.
   - **Reset** — clears the translation and returns the string to `empty` status.
     Use this when the translation is completely wrong and needs to be retranslated from scratch.
   - **Edit in editor** — click the EDID link to open the string inside the full Mod Editor
     for detailed corrections, then return to the queue.

5. **Page through** the results until the queue is empty (or until the remaining strings
   have high enough confidence scores to be trusted).

---

## Review Queue vs. Editor Filter

Both tools can show unreviewed strings.
The difference:

|              | Review Queue                     | Editor Filter                |
| ------------ | -------------------------------- | ---------------------------- |
| **Scope**    | All mods at once                 | One mod at a time            |
| **Sorting**  | By confidence (lowest first)     | By any column                |
| **Best for** | Quick batch review after LLM run | Deep editing of a single mod |

Use the **Review Queue** for a daily review pass after overnight LLM translation.
Use the **Editor Filter** when working deeply on a specific mod.

---

← [Coherence Checker](14-coherence.md) | [Home](README.md) | **Next: [Configuration →](17-configuration.md)**
