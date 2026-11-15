/**
 * The script of the agent's page, as text: it polls `/api/status`, fills the
 * page with `textContent` only (journal lines and errors carry file names and
 * server answers) and posts the buttons' commands. Plain ES5-style JavaScript
 * with no backticks, so it sits in one template literal untouched.
 */
export const AGENT_UI_SCRIPT = `(function () {
  var T = {
    en: {
      sub: 'Vortex agent', now: 'Now', last: 'Last sync', where: 'Paths and settings', journal: 'Journal',
      sync: 'Sync now', pause: 'Pause', resume: 'Resume', redeliver: 'Deliver langpack again', stop: 'Stop agent',
      server: 'Vortex page on the server', stopAsk: 'Stop the agent? It will have to be started again by hand.',
      gone: 'The agent does not answer: it was stopped or is restarting.',
      idle: 'idle', scanning: 'scanning', uploading: 'uploading', 'waiting-server': 'waiting for the server',
      delivering: 'delivering the langpack', settling: 'waiting for staging to settle', error: 'error',
      paused: 'paused', stopping: 'stopping after this step',
      hbOk: 'Server answered', hbFail: 'Server does not answer', hbNone: 'No heartbeat yet',
      settle: 'Sync starts in', retry: 'Next attempt in', attempt: 'failed attempts:', queued: 'Sync requested: starts on the next tick',
      pausedNote: 'Paused: no sync, upload or delivery until resumed. A restart resumes too.',
      lastError: 'Last error', lastSync: 'Last sync', run: 'Run', fullScan: 'Next full scan',
      scan: 'Last scan', units: 'units', game: 'game', plugins: 'plugins enabled', delivered: 'Delivered langpack',
      latest: 'Waits on the server', rejected: 'Refused by the server', none: 'nothing yet',
      staging: 'Staging', gameDir: 'Game folder', downloads: 'Vortex downloads', config: 'Config', journalFile: 'Journal file',
      poll: 'Poll / settle / full scan', auto: 'Runs on its own up to', deliver: 'Delivers langpacks', videos: 'Videos',
      setup: 'The agent has no settings it can start with:', setupBadge: 'setup',
      reloading: 'New settings are saved: they apply after the current step.',
      yes: 'yes', no: 'no', empty: 'The journal is empty.', sec: 's', min: 'min'
    },
    uk: {
      sub: 'агент Vortex', now: 'Зараз', last: 'Остання синхронізація', where: 'Шляхи та налаштування', journal: 'Журнал',
      sync: 'Синхронізувати зараз', pause: 'Пауза', resume: 'Продовжити', redeliver: 'Доставити ленгпак ще раз', stop: 'Зупинити агента',
      server: 'Сторінка Vortex на сервері', stopAsk: 'Зупинити агента? Запускати його доведеться вручну.',
      gone: 'Агент не відповідає: його зупинено або він перезапускається.',
      idle: 'спокій', scanning: 'сканує', uploading: 'заливає', 'waiting-server': 'чекає на сервер',
      delivering: 'доставляє ленгпак', settling: 'чекає, поки стейдж устоїться', error: 'помилка',
      paused: 'пауза', stopping: 'зупиняється після цього кроку',
      hbOk: 'Сервер відповів', hbFail: 'Сервер не відповідає', hbNone: 'Heartbeat ще не було',
      settle: 'Синк почнеться через', retry: 'Наступна спроба через', attempt: 'невдалих спроб:', queued: 'Синк замовлено: почнеться з наступного тіка',
      pausedNote: 'Пауза: жодного синку, заливання чи доставки, доки не продовжите. Перезапуск теж знімає паузу.',
      lastError: 'Остання помилка', lastSync: 'Останній синк', run: 'Прогін', fullScan: 'Наступний повний скан',
      scan: 'Останній скан', units: 'юнітів', game: 'гра', plugins: 'плагінів увімкнено', delivered: 'Доставлений ленгпак',
      latest: 'Чекає на сервері', rejected: 'Сервер відхилив', none: 'ще нічого',
      staging: 'Стейдж', gameDir: 'Тека гри', downloads: 'Завантаження Vortex', config: 'Конфіг', journalFile: 'Файл журналу',
      poll: 'Опитування / тиша / повний скан', auto: 'Сам запускає до стадії', deliver: 'Доставляє ленгпаки', videos: 'Ролики',
      setup: 'Агент не має налаштувань, з якими може стартувати:', setupBadge: 'налаштування',
      reloading: 'Нові налаштування збережено: вони подіють після поточного кроку.',
      yes: 'так', no: 'ні', empty: 'Журнал порожній.', sec: 'с', min: 'хв'
    }
  };
  var L = (navigator.language || '').toLowerCase().indexOf('uk') === 0 ? T.uk : T.en;
  function t(k) { return L[k] || T.en[k] || k; }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function when(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
  function left(iso, now) {
    var s = Math.max(0, Math.round((Date.parse(iso) - Date.parse(now)) / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function mib(n) { return (n / 1048576).toFixed(0) + ' MiB'; }
  function facts(id, rows) {
    var dl = $(id);
    dl.textContent = '';
    rows.forEach(function (row) {
      if (row[1] == null || row[1] === '') return;
      dl.appendChild(el('dt', '', t(row[0])));
      dl.appendChild(el('dd', row[2] || '', String(row[1])));
    });
  }
  function note(lines, cls, text) { lines.appendChild(el('p', cls, text)); }

  function render(s) {
    $('gone').hidden = true;
    var live = !s.setup;
    document.querySelectorAll('.live').forEach(function (e) { e.hidden = !live; });
    $('setup').hidden = live;
    if (window.agentSettings) window.agentSettings.status(s);
    var badge = $('badge');
    if (!live) {
      $('who').textContent = s.machine + ' · ' + s.version;
      badge.textContent = t('setupBadge');
      badge.className = 'badge muted';
      $('setup').textContent = t('setup') + ' ' + s.configError;
      return;
    }
    $('who').textContent = s.machine + ' · ' + s.version + ' · ' + s.game;
    badge.textContent = t(s.state);
    badge.className = 'badge ' + (s.state === 'error' ? 'bad' : s.state === 'idle' ? 'ok'
      : s.state === 'paused' || s.state === 'stopping' ? 'muted' : 'busy');

    var lines = $('lines');
    lines.textContent = '';
    if (s.activity) {
      var a = s.activity;
      note(lines, 'act', a.text + (a.done != null && a.total ? ' — ' + mib(a.done) + ' / ' + mib(a.total) : ''));
      if (a.total) {
        var bar = el('div', 'bar');
        var fill = el('div', 'fill');
        fill.style.width = Math.min(100, Math.round(((a.done || 0) / a.total) * 100)) + '%';
        bar.appendChild(fill);
        lines.appendChild(bar);
      }
    }
    if (s.reloading) note(lines, 'dim', t('reloading'));
    if (s.paused) note(lines, 'dim', t('pausedNote'));
    if (s.syncRequested) note(lines, 'dim', t('queued'));
    if (s.settleUntil) note(lines, '', t('settle') + ' ' + left(s.settleUntil, s.now));
    if (s.retryAfter) note(lines, '', t('retry') + ' ' + left(s.retryAfter, s.now) + ' (' + t('attempt') + ' ' + s.failures + ')');
    var hb = s.server;
    note(lines, hb.ok === false ? 'bad' : 'dim',
      (hb.ok == null ? t('hbNone') : hb.ok ? t('hbOk') + ' ' + when(hb.heartbeatAt) : t('hbFail') + ': ' + hb.error) + ' · ' + hb.api);
    if (s.lastError) note(lines, 'bad', t('lastError') + ': ' + s.lastError);

    $('pause').textContent = t(s.paused ? 'resume' : 'pause');
    $('pause').dataset.command = s.paused ? 'resume' : 'pause';
    var stopping = s.state === 'stopping';
    ['sync', 'pause', 'redeliver', 'stop'].forEach(function (id) { $(id).disabled = stopping; });
    if (!stopping) $('sync').disabled = s.syncRequested;
    if (!stopping) $('redeliver').disabled = !s.delivered || !s.settings.deliverLangpack;
    $('server').href = hb.pageUrl;

    var scan = s.scan;
    facts('last', [
      ['lastSync', when(s.lastSyncAt)],
      ['run', s.lastRunId != null ? '#' + s.lastRunId : null],
      ['fullScan', s.nextFullScanAt ? when(s.nextFullScanAt) : null],
      ['scan', scan ? when(scan.at) + ' · ' + scan.units + ' ' + t('units') + (scan.gameVersion ? ' · ' + t('game') + ' ' + scan.gameVersion : '')
        + ' · ' + scan.enabledPlugins + '/' + scan.plugins + ' ' + t('plugins') : null],
      ['delivered', s.delivered ? s.delivered.fileName + ' · ' + when(s.delivered.at) : t('none')],
      ['latest', s.latestLangpack && (!s.delivered || s.delivered.archiveId !== s.latestLangpack.archiveId)
        ? s.latestLangpack.fileName + ' (r' + s.latestLangpack.archiveId + ')' : null],
      ['rejected', s.rejected.length ? s.rejected.join(', ') : null, 'bad']
    ]);
    var c = s.settings;
    facts('where', [
      ['staging', s.paths.staging, 'mono'], ['gameDir', s.paths.gameDir, 'mono'],
      ['downloads', s.paths.downloads, 'mono'], ['config', s.paths.config, 'mono'],
      ['journalFile', s.paths.journal, 'mono'],
      ['poll', c.pollSec + ' ' + t('sec') + ' / ' + c.settleSec + ' ' + t('sec') + ' / ' + c.fullScanEveryMin + ' ' + t('min')],
      ['auto', c.autoStages], ['deliver', t(c.deliverLangpack ? 'yes' : 'no')], ['videos', t(c.videos ? 'yes' : 'no')]
    ]);

    var body = $('journal');
    body.textContent = '';
    s.journal.slice().reverse().forEach(function (entry) {
      var tr = el('tr', /error$/.test(String(entry.event)) ? 'bad' : '');
      tr.appendChild(el('td', 'time', when(entry.at)));
      tr.appendChild(el('td', 'time', String(entry.event || '')));
      var rest = [];
      Object.keys(entry).forEach(function (k) {
        if (k === 'at' || k === 'event') return;
        var v = entry[k];
        if (v == null || (Array.isArray(v) && !v.length)) return;
        rest.push(k === 'message' ? String(v) : k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v));
      });
      tr.appendChild(el('td', 'wrap', rest.join(' · ')));
      body.appendChild(tr);
    });
    $('empty').hidden = s.journal.length > 0;
  }

  function poll() {
    fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(render, function () { $('gone').hidden = false; });
  }
  function send(command) {
    fetch('/api/command/' + command, { method: 'POST', headers: { 'X-Transynth-Agent': '1' } }).then(poll, poll);
  }
  document.querySelectorAll('[data-t]').forEach(function (e) { e.textContent = t(e.dataset.t); });
  document.documentElement.lang = L === T.uk ? 'uk' : 'en';
  document.querySelectorAll('button[data-command]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.command === 'stop' && !confirm(t('stopAsk'))) return;
      send(b.dataset.command);
    });
  });
  poll();
  setInterval(poll, 2000);
})();`;
