/**
 * The agent's page: one self-contained HTML document (no build step, no
 * assets), in the web UI's colours, light or dark by the system setting.
 */
import { AGENT_UI_SCRIPT } from './uiPageScript';
import { AGENT_UI_SETTINGS_SCRIPT } from './uiPageSettings';

const STYLE = `
:root {
  color-scheme: dark light;
  --bg: #161514; --card: #201e1b; --input: #26231f; --border: #312d28;
  --text: #d0cbc3; --dim: #948b7f; --accent: #d2a348; --ok: #57b56c; --bad: #df6b6b;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f1ede5; --card: #fffdf9; --input: #fffdf9; --border: #d4c8b8;
    --text: #342f28; --dim: #7a6f61; --accent: #a87a24; --ok: #3d8a50; --bad: #be4d4d;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 20px 16px 40px; background: var(--bg); color: var(--text);
  font: 14px/1.45 system-ui, 'Segoe UI', sans-serif;
}
main { max-width: 860px; margin: 0 auto; display: grid; gap: 12px; }
header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 18px; margin: 0; font-weight: 600; }
h1 span { color: var(--dim); font-weight: 400; }
#who { color: var(--dim); flex: 1; min-width: 0; }
h2 { font-size: 12px; margin: 0 0 8px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
section { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
p { margin: 4px 0; overflow-wrap: anywhere; }
.badge { padding: 3px 10px; border-radius: 999px; font-size: 13px; white-space: nowrap; }
.badge.ok { background: color-mix(in srgb, var(--ok) 20%, transparent); color: var(--ok); }
.badge.busy { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
.badge.bad { border: 1px solid var(--bad); color: var(--bad); }
.badge.muted { background: var(--input); color: var(--dim); }
.dim { color: var(--dim); }
.bad { color: var(--bad); }
.act { font-weight: 600; }
.mono, .time { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
.bar { height: 6px; border-radius: 3px; background: var(--input); border: 1px solid var(--border); overflow: hidden; }
.fill { height: 100%; background: var(--accent); }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
button {
  font: inherit; color: var(--text); background: var(--input); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 12px; cursor: pointer;
}
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
button.danger { color: var(--bad); }
a { color: var(--accent); }
.buttons a { margin-left: auto; }
dl { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 4px 16px; margin: 0; }
dt { color: var(--dim); }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
td { padding: 4px 12px 4px 0; vertical-align: top; border-top: 1px solid var(--border); }
tr:first-child td { border-top: 0; }
td.time { white-space: nowrap; }
td.time:first-child { color: var(--dim); }
td.wrap { overflow-wrap: anywhere; }
#gone, #setup { border-color: var(--bad); color: var(--bad); }
summary { cursor: pointer; font-size: 12px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
details[open] summary { margin-bottom: 12px; }
form { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px 16px; }
label { display: grid; gap: 3px; color: var(--dim); font-size: 13px; min-width: 0; }
label.check { display: flex; gap: 8px; align-items: center; color: var(--text); }
input, select {
  font: inherit; color: var(--text); background: var(--input); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 8px; min-width: 0; width: 100%;
}
input[type='checkbox'] { width: auto; accent-color: var(--accent); }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#formEnd { grid-column: 1 / -1; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
#autoRow { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
@media (max-width: 560px) {
  dl { grid-template-columns: 1fr; gap: 0; }
  dd { margin-bottom: 6px; }
  .buttons a { margin-left: 0; }
}
`;

export const AGENT_UI_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transynth · Vortex agent</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>Transynth <span data-t="sub"></span></h1>
    <span id="who"></span>
    <span id="badge" class="badge muted">…</span>
  </header>
  <section id="gone" hidden data-t="gone"></section>
  <section id="setup" hidden></section>
  <section class="live">
    <h2 data-t="now"></h2>
    <div id="lines"></div>
    <div class="buttons">
      <button id="sync" class="primary" data-command="sync" data-t="sync"></button>
      <button id="pause" data-command="pause" data-t="pause"></button>
      <button id="redeliver" data-command="redeliver" data-t="redeliver"></button>
      <button id="stop" class="danger" data-command="stop" data-t="stop"></button>
      <a id="server" target="_blank" rel="noopener" data-t="server"></a>
    </div>
  </section>
  <section class="live">
    <h2 data-t="last"></h2>
    <dl id="last"></dl>
  </section>
  <section class="live">
    <h2 data-t="where"></h2>
    <dl id="where"></dl>
  </section>
  <section>
    <details id="settings">
      <summary data-s="settings"></summary>
      <div id="autoRow" hidden>
        <label class="check"><input type="checkbox" id="autostart"><span data-s="autostart"></span></label>
        <p id="autoFile" class="dim mono"></p>
        <p id="autoMsg" class="bad"></p>
      </div>
      <form id="form">
        <div id="formEnd">
          <button class="primary" type="submit" data-s="save"></button>
          <span id="formMsg" class="dim"></span>
        </div>
      </form>
    </details>
  </section>
  <section class="live">
    <h2 data-t="journal"></h2>
    <p id="empty" class="dim" data-t="empty" hidden></p>
    <div class="scroll"><table><tbody id="journal"></tbody></table></div>
  </section>
</main>
<script>${AGENT_UI_SETTINGS_SCRIPT}</script>
<script>${AGENT_UI_SCRIPT}</script>
</body>
</html>
`;
