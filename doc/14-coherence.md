# 14 — Coherence Checker

Find and fix inconsistencies where the same source text is translated
in multiple different ways.

---

## Table of Contents

- [What is Coherence?](#what-is-coherence)
- [Opening the Coherence Checker](#opening-the-coherence-checker)
- [Reading the Results](#reading-the-results)
- [Fixing Inconsistencies](#fixing-inconsistencies)
- [When to Run the Coherence Checker](#when-to-run-the-coherence-checker)

---

## What is Coherence?

A translation is **coherent** when the same source phrase always produces
the same translation throughout the mod (and ideally across all mods).

Incoherence looks like:
- "Take care, wanderer." translated as "Бережись, мандрівнику." in one place
  and "Обережно, мандрівнику." in another.
- NPC name "Paladin Danse" translated differently in two dialogue lines.

Inconsistencies confuse players and signal a low-quality translation.

---

## Opening the Coherence Checker

Navigate to **Coherence** in the top navigation bar (route: `/coherence`).

> TODO: Screenshot of the coherence page.

---

## Reading the Results

The coherence checker lists **source strings that have more than one distinct
translation** across the database.

> TODO: Describe the results table columns:
> - Source text
> - Number of distinct translations found
> - List of each distinct translation with count
> - Which mods/records each translation appears in
> Screenshot placeholder.

---

## Fixing Inconsistencies

> TODO: Describe the workflow for resolving a coherence issue:
> 1. Click the source string row to expand all variant translations.
> 2. Decide which translation is correct.
> 3. Click "Apply everywhere" to replace all occurrences with the chosen translation.
>    OR
>    Click individual rows to navigate to those strings in the editor and fix manually.
> Screenshot placeholder.

---

## When to Run the Coherence Checker

> TODO: Practical guidance:
> - Run before exporting a final release.
> - Run after LLM batch translation (LLM may produce varied results for identical strings).
> - Run after merging TMX from another translator.
> - For large mods, focus on high-frequency source phrases first (e.g. dialogue openers).

---

← [Dashboard](13-dashboard.md) | [Home](README.md) | **Next: [Review Queue →](15-review-queue.md)**
