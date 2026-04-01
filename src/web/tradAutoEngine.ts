/**
 * tradAutoEngine.ts — Pattern-match translation rule engine.
 *
 * TradAuto rule engine.  Each rule contains a source `pattern` and
 * a `replacement` template that use numbered `%VARn%` placeholders.  At apply
 * time the engine:
 *
 * 1. Compiles `pattern` → RegExp (once, cached).
 * 2. Tests every untranslated source string against active rules in priority
 *    order (lower number = higher precedence).
 * 3. On first match, captures groups and interpolates them into `replacement`.
 * 4. First-match-wins: once a rule matches a string, no further rules are tried.
 *
 * ## Placeholder syntax
 *
 * - `%VAR1%`, `%VAR2%`, … — numbered variable placeholders.  In the source
 *   pattern each one becomes a non-greedy capture group `(.+?)`.  In the
 *   replacement template the same tag is substituted with the captured text.
 * - Literal text around placeholders is escaped so regex meta-characters are
 *   safe (e.g. `(` in source patterns does not break the regex).
 *
 * ## Scope filters
 *
 * Each rule can optionally be scoped to a specific record `signature` (GRUP
 * type like `WEAP`, `ARMO`) and/or `path` (field like `FULL`, `DESC`).  A
 * `null` scope means "matches any".
 *
 * ## Integration
 *
 * The engine is intentionally independent of the HTTP layer.  Routes call
 * {@link loadActiveRules}, {@link compileRule}, and {@link applyRules} directly.
 */

import type { Tx } from '../db';
import { log } from '../logger';

/* ── Types ────────────────────────────────────────────────────────────────── */

/** DB row shape for a TradAuto rule. */
export interface TradAutoRule {
  id: number;
  game: string;
  priority: number;
  pattern: string;
  replacement: string;
  signature: string | null;
  path: string | null;
  src_lang: string;
  tgt_lang: string;
  description: string | null;
  is_active: boolean;
}

/** A compiled rule ready for matching — includes the pre-built RegExp. */
export interface CompiledRule {
  rule: TradAutoRule;
  /** RegExp built from `rule.pattern` with numbered capture groups. */
  regex: RegExp;
  /**
   * Ordered list of variable names found in `rule.pattern`
   * (e.g. `['VAR1', 'VAR2']`).
   */
  vars: string[];
}

/** Result of applying a rule to a single string. */
export interface RuleMatchResult {
  /** The rule that matched. */
  ruleId: number;
  /** Generated translation text after placeholder substitution. */
  translated: string;
}

/** Input descriptor for a string to be matched. */
export interface MatchInput {
  /** Source string text. */
  text: string;
  /** Optional GRUP signature for scope filtering (e.g. `WEAP`). */
  signature?: string | null;
  /** Optional field path for scope filtering (e.g. `FULL`). */
  path?: string | null;
}

/* ── Pattern compilation ──────────────────────────────────────────────────── */

/**
 * Regex that detects `%VARn%` tokens inside a pattern string.
 * Supports 1-digit or 2-digit indices (`%VAR1%` through `%VAR99%`).
 */
const VAR_TOKEN = /%VAR(\d{1,2})%/g;

/**
 * Escapes all regex-special characters in a literal string fragment.
 * Used to safely embed user-provided pattern text into a RegExp.
 */
const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compiles a single TradAuto rule into a {@link CompiledRule} with a RegExp
 * and ordered variable list.
 *
 * The source `pattern` is split by `%VARn%` tokens.  Literal segments are
 * regex-escaped, and each token is replaced with a non-greedy capture group
 * `(.+?)`.  The final regex is case-insensitive and anchored to match the
 * full string.
 *
 * @throws {Error} if no `%VARn%` tokens are found in the pattern — a plain
 *         string match without variables is not useful for TradAuto.
 *         (Static replacements should be done via search-and-replace instead.)
 */
export const compileRule = (rule: TradAutoRule): CompiledRule => {
  const vars: string[] = [];
  let lastIdx = 0;
  let regexStr = '^';
  let match: RegExpExecArray | null;

  /* Reset global regex state before iteration. */
  VAR_TOKEN.lastIndex = 0;

  while ((match = VAR_TOKEN.exec(rule.pattern)) !== null) {
    /* Literal segment between previous token end and this token start. */
    const literal = rule.pattern.slice(lastIdx, match.index);
    regexStr += escapeRegex(literal);
    /* Non-greedy capture group for the variable. */
    regexStr += '(.+?)';
    vars.push(`VAR${match[1]}`);
    lastIdx = match.index + match[0].length;
  }

  /* Trailing literal after the last token. */
  const tail = rule.pattern.slice(lastIdx);
  regexStr += escapeRegex(tail);
  regexStr += '$';

  const regex = new RegExp(regexStr, 'i');
  return { rule, regex, vars };
};

/* ── Rule loading ─────────────────────────────────────────────────────────── */

/**
 * Loads all active TradAuto rules from the database, ordered by priority
 * ascending (lower priority number = checked first = higher precedence).
 *
 * @param db      - Database connection.
 * @param game    - Game filter (e.g. `'fo4'`).
 * @param srcLang - Source language (default `'en'`).
 * @param tgtLang - Target language (default `'uk'`).
 * @returns Array of {@link TradAutoRule} rows.
 */
export const loadActiveRules = async (
  db: Tx,
  game = 'fo4',
  srcLang = 'en',
  tgtLang = 'uk',
): Promise<TradAutoRule[]> => {
  const { rows } = await db.query(
    `SELECT id, game, priority, pattern, replacement, signature, path,
            src_lang, tgt_lang, description, is_active
     FROM tradauto_rules
     WHERE is_active = TRUE AND game = $1 AND src_lang = $2 AND tgt_lang = $3
     ORDER BY priority ASC, id ASC`,
    [game, srcLang, tgtLang],
  );
  return rows as TradAutoRule[];
};

/* ── Matching & application ───────────────────────────────────────────────── */

/**
 * Tests whether a compiled rule's scope filters match a given string context.
 *
 * @param cr   - Compiled rule with optional signature / path filters.
 * @param sig  - Actual GRUP signature of the string (e.g. `'WEAP'`).
 * @param path - Actual field path of the string (e.g. `'FULL'`).
 * @returns `true` if the rule applies to this context.
 */
const scopeMatches = (cr: CompiledRule, sig?: string | null, path?: string | null): boolean => {
  if (cr.rule.signature && sig && cr.rule.signature.toUpperCase() !== sig.toUpperCase()) return false;
  if (cr.rule.path && path && cr.rule.path.toUpperCase() !== path.toUpperCase()) return false;
  return true;
};

/**
 * Tries to match a single source text against one compiled rule.
 *
 * @returns Translated text if the rule matches, or `null` if it doesn't.
 */
const tryMatch = (cr: CompiledRule, text: string): string | null => {
  const m = cr.regex.exec(text);
  if (!m) return null;

  /* Build the replacement string by substituting captured groups. */
  let result = cr.rule.replacement;
  for (let i = 0; i < cr.vars.length; i++) {
    const tag = `%${cr.vars[i]}%`;
    result = result.replaceAll(tag, m[i + 1]);
  }
  return result;
};

/**
 * Applies a list of pre-compiled rules to a batch of input strings.
 *
 * For each input, rules are tried in order (by priority).  The first rule
 * that matches produces the translation; if no rule matches, the input is
 * skipped (returned as `null`).
 *
 * @param compiled - Compiled rules sorted by priority (ascending).
 * @param inputs   - Source strings with optional scope context.
 * @returns Array parallel to `inputs` — each entry is either a
 *          {@link RuleMatchResult} or `null` if no rule matched.
 */
export const applyRules = (
  compiled: CompiledRule[],
  inputs: MatchInput[],
): (RuleMatchResult | null)[] => {
  return inputs.map((input) => {
    for (const cr of compiled) {
      if (!scopeMatches(cr, input.signature, input.path)) continue;
      const translated = tryMatch(cr, input.text);
      if (translated !== null) {
        return { ruleId: cr.rule.id, translated };
      }
    }
    return null;
  });
};

/**
 * Convenience: load rules from DB, compile them, and apply to inputs.
 *
 * @param db      - Database connection.
 * @param inputs  - Source strings to match.
 * @param game    - Game filter.
 * @param srcLang - Source language.
 * @param tgtLang - Target language.
 * @returns Parallel array of match results (null = no rule matched).
 */
export const loadAndApply = async (
  db: Tx,
  inputs: MatchInput[],
  game = 'fo4',
  srcLang = 'en',
  tgtLang = 'uk',
): Promise<(RuleMatchResult | null)[]> => {
  const rules = await loadActiveRules(db, game, srcLang, tgtLang);
  if (rules.length === 0) return inputs.map(() => null);

  const compiled = rules.map(compileRule);
  log.debug(`TradAuto: ${compiled.length} rules compiled, applying to ${inputs.length} strings`);

  const results = applyRules(compiled, inputs);
  const matched = results.filter(Boolean).length;
  if (matched > 0) log.info(`TradAuto: ${matched}/${inputs.length} strings matched`);

  return results;
};
