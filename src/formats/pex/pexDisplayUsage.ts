/**
 * Whether a script string is only ever shown to the player.
 *
 * Patching a PEX string-table entry changes every use of it: the same literal
 * that a popup shows can be a state name (`GoToState("Done")`), an animation
 * event (`PlayAnimation("Reset")`), a stat (`IncrementStat("Workshops
 * Unlocked")`) or a value a script compares. A translation of those breaks the
 * script, so export only trusts a translation when every place the decompiled
 * source uses the literal is a call that displays it.
 */
import { parsePexStoredContext } from './pexStoredContext';

/** Calls whose string argument reaches the screen. */
const DISPLAY_CALL_RE =
  /\b(?:MessageBox|Notification|ShowMessage|ShowWarning|AddHUDMessage|SetHudText|PrepareSubBar|CreateProgressBar|SetProgressBarText)\s*\(/i;

/** The literal as decompiled Papyrus source spells it. */
const quoted = (literal: string) =>
  `"${literal
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;

/**
 * True when the stored decompiled context (`strings.context`, `pex-json:`)
 * shows the literal, quoted exactly, only inside display calls. Unknown usage —
 * no context, or a use outside the stored window — is not display.
 */
export const isPexDisplayOnlyString = (
  literal: string,
  storedContext: string | null | undefined,
): boolean => {
  const snippet = parsePexStoredContext(storedContext);
  if (!snippet || snippet.matchLineNumbers.length === 0) return false;
  const byLine = new Map(snippet.contextLines.map((line) => [line.lineNumber, line.text]));
  const needle = quoted(literal);
  return snippet.matchLineNumbers.every((lineNumber) => {
    const text = byLine.get(lineNumber);
    return text != null && text.includes(needle) && DISPLAY_CALL_RE.test(text);
  });
};
