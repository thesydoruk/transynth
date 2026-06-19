# Transynth (TSN) — Project Wiki

Welcome to the documentation for **Transynth (TSN)** — a web-based platform
for translating game mods and maintaining the surrounding localization toolchain.

This wiki covers both **end-user workflows** and **technical project documentation**. Some
pages are aimed at translators and reviewers, while others describe architecture, runtime
components, and development tooling.

---

## Table of Contents

| #   | Page                                           | What you'll learn                                                 |
| --- | ---------------------------------------------- | ----------------------------------------------------------------- |
| 1   | [Getting Started](01-getting-started.md)       | Installation, Docker, first launch, login                         |
| 2   | [Importing Mods](02-importing-mods.md)         | How to upload ESP/ESM/ESL files and BA2 archives                  |
| 3   | [The Editor](03-editor.md)                     | Navigating the string grid, filters, inline editing, detail panel |
| 4   | [Keyboard Shortcuts](04-keyboard-shortcuts.md) | Complete shortcut reference table                                 |
| 5   | [Translation Memory](05-translation-memory.md) | TM waterfall, auto-apply, fuzzy and numeric matching              |
| 6   | [LLM Translation](06-llm-translation.md)       | AI-assisted translation with OpenAI or vLLM                       |
| 7   | [Quality Assurance](07-qa.md)                  | QA issues, types, severity levels, configuring rules              |
| 8   | [Glossary](08-glossary.md)                     | Managing terminology, injecting terms into LLM prompts            |
| 9   | [Exporting](09-export.md)                      | Creating patched ESP, STRINGS files, BA2 archives, ZIP            |
| 10  | [TMX Exchange](10-tmx.md)                      | Sharing translation memory with Trados, memoQ, OmegaT             |
| 11  | [Diff & Re-import](11-diff-and-reimport.md)    | Updating a mod to a new version, carrying over translations       |
| 12  | [Special Editors](12-special-editors.md)       | INNR editor, Book/HTML editor, BA2 browser, ESP explorer          |
| 13  | [Dashboard](13-dashboard.md)                   | Translation progress statistics and charts                        |
| 14  | [Coherence Checker](14-coherence.md)           | Finding and fixing inconsistent translations                      |
| 15  | [Review Queue](15-review-queue.md)             | Reviewing low-confidence or auto-translated strings               |
| 16  | [Team & Users](16-team-and-users.md)           | Multi-user mode, roles, permissions, activity log                 |
| 17  | [Configuration](17-configuration.md)           | Environment variables, Docker setup, provider settings            |
| 18  | [TradAuto Rules](18-tradauto.md)               | Pattern-match auto-translation engine, rule management            |
| 19  | [Technology Stack](19-technology-stack.md)     | Runtime, backend, frontend, database, AI, tooling, Docker         |

---

## Quick Overview

The pipeline covers the complete localization workflow for a Bethesda mod:

```
Import mod (ESP/BA2)
   ↓
Automatic TM match ←── Translation Memory (5-method waterfall)
   ↓
LLM batch translate ←── OpenAI / vLLM
   ↓
Human review in web editor
   ↓
QA check ←── 9 issue types + configurable rules
   ↓
Export (STRINGS / patched ESP / BA2)
```

---

## Supported Games

Transynth supports the following Bethesda titles:

- Fallout 4 (`fo4`)
- Fallout 76 (`fo76`)
- Fallout 3 (`fo3`)
- Fallout: New Vegas (`fnv`)
- The Elder Scrolls IV: Oblivion (`ob`)
- The Elder Scrolls III: Morrowind (`mw`)
- Skyrim Special Edition (`sse`)
- Skyrim Legendary Edition (`sle`)

Archive/export behavior depends on the selected game profile:

- FO4 / FO76: BA2 workflow
- FO3 / FNV / OB / MW / SSE / SLE: BSA workflow

---

## Where to Start

- **New user?** → Start with [Getting Started](01-getting-started.md).
- **Just want to translate?** → Read [Importing Mods](02-importing-mods.md) then [The Editor](03-editor.md).
- **Setting up AI?** → See [LLM Translation](06-llm-translation.md).
- **Working in a team?** → See [Team & Users](16-team-and-users.md).
- **Need development context?** → Read [Technology Stack](19-technology-stack.md).
