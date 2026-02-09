# 18 — TradAuto Rule Engine

The **TradAuto** page provides a pattern-match automatic translation engine inspired by the
original TradAuto engine. Each rule defines a **source pattern** (with placeholder variables)
and a **replacement template**. When applied, rules are matched against untranslated strings in
priority order — the first matching rule wins and produces a translation automatically.

---

## Concepts

### Pattern Syntax

Patterns use `%VAR1%`, `%VAR2%`, … `%VARn%` as placeholders for arbitrary text fragments.
The engine compiles each pattern into a regular expression with non-greedy capture groups.

| Pattern           | Matches                     | Replacement       | Result                  |
| ----------------- | --------------------------- | ----------------- | ----------------------- |
| `%VAR1% Sword`    | `Iron Sword`, `Glass Sword` | `Меч %VAR1%`      | `Меч Iron`, `Меч Glass` |
| `%VAR1%'s %VAR2%` | `Piper's Coat`              | `%VAR2% — %VAR1%` | `Coat — Piper`          |
| `Stimpak`         | `Stimpak` (literal)         | `Стімпак`         | `Стімпак`               |

### Priority

Each rule has a numeric **priority** (lower = higher precedence). When multiple rules could match
the same source string, the rule with the lowest priority number wins.

### Scoping

Rules can optionally be scoped to:

- **GRUP** (signature) — e.g. `WEAP`, `ARMO`, `NPC_`. If set, the rule only applies to strings
  from records of that type.
- **Field** (path) — e.g. `FULL`, `DESC`. If set, the rule only applies to that specific field
  within a record.

Leave both blank for a global rule that applies to any string.

---

## Managing Rules

Open the **TradAuto** page from the navigation bar. The top section shows an add form and the
rules table.

### Adding a Rule

1. Set the **Priority** (default 10).
2. Enter the **Pattern** — the source-language template with `%VARn%` placeholders.
3. Enter the **Replacement** — the target-language template referencing the same variables.
4. Optionally set **GRUP** and/or **Field** to scope the rule.
5. Add an optional **Description** to document the rule's purpose.
6. Click **Add Rule**.

The backend validates the pattern at creation time — if the pattern is malformed, an error is
shown.

### Editing / Deleting

- Click **Edit** on any row to enter inline-edit mode. Change fields and press **Save**.
- Click **Delete** to remove a rule (requires confirmation).
- Toggle the **Active** checkbox to enable/disable a rule without deleting it.

---

## Testing Rules (Dry-run)

Below the rules table is the **Test Rules** panel:

1. Enter one or more source texts, one per line.
2. Click **Test**.
3. For each line, the panel shows:
   - The matched translation and rule ID (if a rule matched).
   - "no match" if no rule applies.

This does not modify any data — it's a read-only preview of how rules would behave.

---

## Applying Rules to a Mod

The **Apply to Mod** panel lets you run all active rules against a mod's untranslated strings:

1. Select a **Mod** from the dropdown.
2. Check **Dry run** to preview results without saving (recommended first).
3. Click **Apply Rules**.

In dry-run mode, the system reports how many strings would match. Uncheck dry run and apply again
to actually save the translations. Saved translations get:

- **Status:** `auto`
- **Provenance:** `tradauto`
- **Model:** `rule_<id>` (the matching rule's ID)

---

## Tips

- Start with high-priority (low number) rules for common, specific patterns and use higher numbers
  for catch-all fallbacks.
- Use the dry-run test panel to verify rules before applying them to a whole mod.
- TradAuto works alongside LLM batch translation and Translation Memory — strings translated by
  TradAuto rules won't be re-translated by other methods.
- Rules are language-pair specific (`src_lang` / `tgt_lang`) so you can maintain separate rule sets
  for different target languages.

---

← [Configuration](17-configuration.md) | [Home](README.md)
