/**
 * The settings part of the agent page's script: the form over the config file
 * and the start-at-sign-in switch. It loads the form when the section opens
 * (never while somebody types in it), sends only what the form holds, and
 * shows the server's own words when a save is refused. No backticks inside.
 */
export const AGENT_UI_SETTINGS_SCRIPT = `(function () {
  var T = {
    en: {
      settings: 'Settings', save: 'Save', saved: 'Saved. The agent restarts its loop with the new settings after the current step.',
      autostart: 'Start the agent when I sign in to Windows', autostartFile: 'Launcher:',
      api: 'Server address', token: 'CLI token', game: 'Game', stagingPath: 'Vortex staging folder', gameDir: 'Game folder',
      group: 'Group to join: a shared name, or the other computer’s staging folder (optional)',
      downloadsDir: 'Vortex downloads folder', pluginsTxt: 'plugins.txt (optional)', vortexProfile: 'Vortex profile (optional)',
      srcLang: 'Source language', tgtLang: 'Target language', channel: 'What to sync', autoStages: 'Runs on its own up to',
      pollSec: 'Poll every, s', settleSec: 'Quiet before a sync, s', fullScanEveryMin: 'Full scan every, min',
      uiPort: 'Port of this page (0 turns it off; applies at the next start)', deliverLangpack: 'Deliver langpacks into Vortex downloads',
      videos: 'Register and upload cutscene videos', tokenKeep: 'set — leave empty to keep it', tokenNone: 'not set',
      tokenEnv: 'TRANSYNTH_CLI_TOKEN is set in the environment and wins over this field',
      newFile: 'There is no config file yet: these are the defaults. Fill in the game folder and save.'
    },
    uk: {
      settings: 'Налаштування', save: 'Зберегти', saved: 'Збережено. Агент перезапустить цикл із новими налаштуваннями після поточного кроку.',
      autostart: 'Запускати агента, коли я входжу у Windows', autostartFile: 'Файл запуску:',
      api: 'Адреса сервера', token: 'CLI-токен', game: 'Гра', stagingPath: 'Тека стейджа Vortex', gameDir: 'Тека гри',
      group: 'Група, до якої приєднатися: спільна назва або тека стейджа іншого комп’ютера (необов’язково)',
      downloadsDir: 'Тека завантажень Vortex', pluginsTxt: 'plugins.txt (необов’язково)', vortexProfile: 'Профіль Vortex (необов’язково)',
      srcLang: 'Мова оригіналу', tgtLang: 'Мова перекладу', channel: 'Що синхронізувати', autoStages: 'Сам запускає до стадії',
      pollSec: 'Опитування кожні, с', settleSec: 'Тиша перед синком, с', fullScanEveryMin: 'Повний скан кожні, хв',
      uiPort: 'Порт цієї сторінки (0 вимикає; діє з наступного запуску)', deliverLangpack: 'Доставляти ленгпаки в завантаження Vortex',
      videos: 'Реєструвати й заливати ролики', tokenKeep: 'задано — лишіть порожнім, щоб не міняти', tokenNone: 'не задано',
      tokenEnv: 'TRANSYNTH_CLI_TOKEN задано в середовищі, і він перекриває це поле',
      newFile: 'Файлу конфігу ще немає: це значення за замовчуванням. Впишіть теку гри і збережіть.'
    }
  };
  var L = (navigator.language || '').toLowerCase().indexOf('uk') === 0 ? T.uk : T.en;
  function t(k) { return L[k] || T.en[k] || k; }
  function $(id) { return document.getElementById(id); }
  var FIELDS = [
    ['api', 'text'], ['token', 'password'], ['game', 'select'], ['gameDir', 'text'], ['stagingPath', 'text'],
    ['group', 'text'], ['downloadsDir', 'text'], ['pluginsTxt', 'text'], ['vortexProfile', 'text'], ['srcLang', 'text'], ['tgtLang', 'text'],
    ['channel', 'select', ['all', 'mods', 'game']], ['autoStages', 'select', ['import', 'carry', 'tm']],
    ['pollSec', 'number'], ['settleSec', 'number'], ['fullScanEveryMin', 'number'], ['uiPort', 'number'],
    ['deliverLangpack', 'checkbox'], ['videos', 'checkbox']
  ];
  var form = $('form');
  var inputs = {};
  var loaded = false;

  function options(select, list, value) {
    select.textContent = '';
    list.forEach(function (item) {
      var o = document.createElement('option');
      o.value = item;
      o.textContent = item;
      select.appendChild(o);
    });
    select.value = value;
  }
  function build() {
    FIELDS.forEach(function (f) {
      var label = document.createElement('label');
      var input = document.createElement(f[1] === 'select' ? 'select' : 'input');
      if (f[1] !== 'select') input.type = f[1];
      if (f[1] === 'number') input.min = '0';
      if (f[1] === 'password') input.autocomplete = 'new-password';
      input.name = f[0];
      inputs[f[0]] = input;
      var text = document.createElement('span');
      text.textContent = t(f[0]);
      if (f[1] === 'checkbox') { label.className = 'check'; label.appendChild(input); label.appendChild(text); }
      else { label.appendChild(text); label.appendChild(input); }
      form.insertBefore(label, $('formEnd'));
    });
  }
  function say(text, bad) {
    var m = $('formMsg');
    m.textContent = text;
    m.className = bad ? 'bad' : 'dim';
  }
  function load() {
    return fetch('/api/settings', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
      FIELDS.forEach(function (f) {
        var input = inputs[f[0]];
        if (f[0] === 'token') {
          input.value = '';
          input.placeholder = t(c.tokenSet ? 'tokenKeep' : 'tokenNone');
          input.title = c.tokenFromEnv ? t('tokenEnv') : '';
        } else if (f[1] === 'checkbox') input.checked = c.values[f[0]] === true;
        else if (f[1] === 'select') options(input, f[2] || c.games, String(c.values[f[0]]));
        else input.value = String(c.values[f[0]]);
      });
      loaded = true;
      say(c.exists ? (c.tokenFromEnv ? t('tokenEnv') : '') : t('newFile'), false);
    });
  }
  function values() {
    var out = {};
    FIELDS.forEach(function (f) {
      var input = inputs[f[0]];
      if (f[1] === 'checkbox') out[f[0]] = input.checked;
      else if (f[1] === 'number') out[f[0]] = input.value === '' ? null : Number(input.value);
      else if (f[0] !== 'token' || input.value) out[f[0]] = input.value;
    });
    return out;
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'X-Transynth-Agent': '1', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
    });
  }

  document.querySelectorAll('[data-s]').forEach(function (e) { e.textContent = t(e.dataset.s); });
  build();
  var details = $('settings');
  details.addEventListener('toggle', function () { if (details.open && !loaded) load(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    post('/api/settings', values()).then(
      function () { return load().then(function () { say(t('saved'), false); }); },
      function (err) { say(err.message, true); }
    );
  });
  var auto = $('autostart');
  var autoBusy = false;
  auto.addEventListener('change', function () {
    autoBusy = true;
    post('/api/autostart/' + (auto.checked ? 'on' : 'off')).then(
      function () { autoBusy = false; $('autoMsg').textContent = ''; },
      function (err) { autoBusy = false; $('autoMsg').textContent = err.message; }
    );
  });
  window.agentSettings = {
    status: function (s) {
      $('autoRow').hidden = !s.autostart.supported;
      if (!autoBusy) auto.checked = s.autostart.enabled;
      $('autoFile').textContent = s.autostart.enabled ? t('autostartFile') + ' ' + s.autostart.file : '';
      if (s.setup && !details.open) details.open = true;
    }
  };
})();`;
