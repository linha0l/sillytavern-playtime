import { DAY, localDate, reportData } from './data.mjs';
import { FRONTEND_VERSION, REQUIRED_BACKEND_VERSION, UPDATE_COMMAND, UPDATE_NOTES_URL, UPDATE_REMINDER_RISK, backendUpdateState, readUpdateReminderPreference, saveUpdateReminderPreference } from './updates.mjs';

export function createView({ onExport, onImport, onReset = () => {} }) {
    const dialog = document.createElement('dialog'); dialog.id = 'tavern-playtime-panel';
    const root = document.createElement('div'); root.id = 'tavern-playtime-view';
    root.innerHTML = "<header class=\"tt-header\">\n    <div class=\"tt-brand\"><i class=\"fa-regular fa-clock\" aria-hidden=\"true\"></i>酒馆时长</div>\n    <div class=\"tt-header-right\">\n      <span class=\"tt-status\"><span class=\"tt-dot\"></span>计时中</span>\n      <div class=\"tt-data-menu\">\n        <button type=\"button\" class=\"tt-quiet tt-settings cursor-interaction\" data-action=\"menu\" aria-expanded=\"false\" aria-label=\"设置\"><span class=\"tt-gear-fallback\" aria-hidden=\"true\">⚙</span></button>\n        <div class=\"tt-menu\" hidden>\n          <button type=\"button\" data-action=\"export\">导出数据</button>\n          <button type=\"button\" data-action=\"import\">导入数据</button>\n        </div>\n      </div>\n      <button type=\"button\" class=\"tt-quiet cursor-interaction\" data-action=\"dismiss\" aria-label=\"关闭统计\">×</button>\n    </div>\n  </header>\n  <div class=\"tt-layout\">\n    <nav class=\"tt-sidebar\" aria-label=\"统计范围\">\n      <div class=\"tt-side-label\">全部记录</div>\n      <div class=\"tt-sidebar-list\"></div>\n    </nav>\n    <main class=\"tt-main\">\n      <div class=\"tt-breadcrumb\"></div>\n      <h2 class=\"tt-heading\">酒馆总览</h2>\n      <div class=\"tt-metrics\" aria-live=\"polite\"></div>\n      <div class=\"tt-chart-toolbar\">\n        <div class=\"tt-chart-name\">游戏时长</div>\n        <div class=\"tt-grain\" aria-label=\"时间粒度\">\n          <button type=\"button\" class=\"cursor-interaction\" data-grain=\"day\" aria-pressed=\"true\">日</button>\n          <button type=\"button\" class=\"cursor-interaction\" data-grain=\"week\" aria-pressed=\"false\">周</button>\n          <button type=\"button\" class=\"cursor-interaction\" data-grain=\"month\" aria-pressed=\"false\">月</button>\n        </div>\n      </div>\n      <div class=\"tt-period\">\n        <div class=\"tt-period-label\"></div>\n        <div class=\"tt-period-actions\">\n          <button type=\"button\" class=\"tt-arrow cursor-interaction\" data-action=\"prev\" aria-label=\"上一时段\">‹</button>\n          <button type=\"button\" class=\"tt-arrow cursor-interaction\" data-action=\"next\" aria-label=\"下一时段\">›</button>\n        </div>\n      </div>\n      <div class=\"tt-chart\"></div>\n      <div class=\"tt-legend\"></div>\n      <footer class=\"tt-footer\"><span>Asia/Shanghai</span><span data-record-count></span></footer>\n    </main>\n  </div>\n  <div class=\"tt-popover\" role=\"dialog\" aria-label=\"选中数据\" hidden>\n    <button type=\"button\" class=\"tt-close cursor-interaction\" data-action=\"close\" aria-label=\"关闭标签\">×</button>\n    <div class=\"tt-popover-content\" aria-live=\"polite\"></div>\n  </div>\n";
    dialog.append(root); document.body.append(dialog);
    const $ = selector => root.querySelector(selector);
    const chart = $('.tt-chart');
    const pop = $('.tt-popover');
    const headingRow = document.createElement('div'); headingRow.className = 'tt-heading-row';
    const heading = $('.tt-heading'); heading.before(headingRow); headingRow.append(heading);
    const excludeSwitch = document.createElement('button'); excludeSwitch.type = 'button'; excludeSwitch.className = 'tt-exclude-other'; excludeSwitch.dataset.action = 'exclude-other'; excludeSwitch.setAttribute('role', 'switch'); excludeSwitch.setAttribute('aria-label', '排除未归属时长');
    excludeSwitch.innerHTML = '<span>排除未归属时长</span><span class="tt-switch-track" aria-hidden="true"></span>'; headingRow.append(excludeSwitch);
    const excludeKey = 'tavern-playtime-exclude-other';
    let excludeOther = false;
    try { excludeOther = localStorage.getItem(excludeKey) === 'true'; } catch { /* Keep the default when preferences are unavailable. */ }
    const themeOptions = document.createElement('div');
    themeOptions.className = 'tt-theme-options'; themeOptions.setAttribute('role', 'group'); themeOptions.setAttribute('aria-label', '外观');
    themeOptions.innerHTML = '<button type="button" data-theme="light" aria-pressed="false">浅色</button><button type="button" data-theme="dark" aria-pressed="false">深色</button>';
    $('.tt-menu').prepend(themeOptions);
    const clearButton = document.createElement('button'); clearButton.type = 'button'; clearButton.dataset.action = 'reset'; clearButton.className = 'tt-clear-action'; clearButton.textContent = '清除全部时长数据'; $('.tt-menu').append(clearButton);
    const resetDialog = document.createElement('dialog'); resetDialog.className = 'tt-reset-dialog'; resetDialog.setAttribute('aria-labelledby', 'tt-reset-title');
    resetDialog.innerHTML = '<h3 id="tt-reset-title">清除全部时长数据？</h3><label class="tt-reset-export"><input type="checkbox" checked><span>清除前导出时长数据</span></label><div class="tt-reset-actions"><button type="button" class="tt-quiet" data-reset="cancel" autofocus>取消</button><button type="button" class="tt-quiet tt-clear-action" data-reset="confirm">清除</button></div>';
    root.append(resetDialog);
    let finishReset;
    resetDialog.querySelector('[data-reset="cancel"]').onclick = () => resetDialog.close();
    resetDialog.querySelector('[data-reset="confirm"]').onclick = () => {
      const result = { confirmed: true, exportFirst: resetDialog.querySelector('input').checked };
      const finish = finishReset; finishReset = null; resetDialog.close(); finish?.(result);
    };
    resetDialog.addEventListener('close', () => { const finish = finishReset; finishReset = null; finish?.({ confirmed: false }); });
    const importDialog = document.createElement('dialog'); importDialog.className = 'tt-reset-dialog tt-import-dialog'; importDialog.setAttribute('aria-labelledby', 'tt-import-title');
    importDialog.innerHTML = '<h3 id="tt-import-title">导入时长数据？</h3><p>导入的时长数据将与当前时长数据合并，相同记录不会重复累计。</p><div class="tt-reset-actions"><button type="button" class="tt-quiet" data-import="cancel" autofocus>取消</button><button type="button" class="tt-quiet" data-import="confirm">导入</button></div>';
    root.append(importDialog);
    let finishImport;
    importDialog.querySelector('[data-import="cancel"]').onclick = () => importDialog.close();
    importDialog.querySelector('[data-import="confirm"]').onclick = () => {
      const finish = finishImport; finishImport = null; importDialog.close(); finish?.(true);
    };
    importDialog.addEventListener('close', () => { const finish = finishImport; finishImport = null; finish?.(false); });
    let remindersEnabled = true, backendSeen = false, backendState = backendUpdateState(undefined);
    try { remindersEnabled = readUpdateReminderPreference(localStorage); } catch { /* Use the default if the browser blocks storage access. */ }
    const updateDot = document.createElement('span'); updateDot.className = 'tt-update-dot'; updateDot.hidden = true; updateDot.setAttribute('aria-hidden', 'true'); $('[data-action="menu"]').append(updateDot);
    const versionsButton = document.createElement('button'); versionsButton.type = 'button'; versionsButton.dataset.action = 'versions'; versionsButton.innerHTML = '<span>版本与更新</span><span class="tt-update-label" hidden></span>';
    const updateControls = document.createElement('div'); updateControls.className = 'tt-update-preferences';
    updateControls.innerHTML = '<div class="tt-update-pref-row"><button type="button" class="tt-update-toggle" role="switch" aria-label="后端更新提醒"><span>后端更新提醒</span><span class="tt-switch-track" aria-hidden="true"></span></button><button type="button" class="tt-update-help-button" aria-label="后端更新提醒的风险说明" aria-expanded="false" aria-controls="tt-update-risk">?</button></div><div class="tt-update-risk" id="tt-update-risk" role="tooltip" hidden></div>';
    updateControls.querySelector('.tt-update-risk').textContent = UPDATE_REMINDER_RISK;
    clearButton.before(versionsButton, updateControls);
    const versionDialog = document.createElement('dialog'); versionDialog.className = 'tt-reset-dialog tt-version-dialog'; versionDialog.setAttribute('aria-labelledby', 'tt-version-title');
    versionDialog.innerHTML = '<h3 id="tt-version-title">版本与更新</h3><dl class="tt-version-list"><div><dt>当前前端</dt><dd data-version="frontend"></dd></div><div><dt>运行后端</dt><dd data-version="backend"></dd></div><div><dt>配套后端</dt><dd data-version="required"></dd></div></dl><p class="tt-version-message"></p><label class="tt-command-label" for="tt-update-command">后端更新命令</label><input id="tt-update-command" class="tt-update-command" type="text" readonly spellcheck="false"><p class="tt-update-instruction">在酒馆根目录执行，更新后重启酒馆。</p><div class="tt-version-links"><button type="button" class="tt-quiet" data-action="copy-update-command">复制命令</button><a class="tt-quiet" target="_blank" rel="noopener noreferrer">更新说明</a></div><div class="tt-reset-actions"><button type="button" class="tt-quiet" data-action="version-close" autofocus>关闭</button></div>';
    versionDialog.querySelector('[data-version="frontend"]').textContent = FRONTEND_VERSION;
    versionDialog.querySelector('[data-version="required"]').textContent = REQUIRED_BACKEND_VERSION;
    versionDialog.querySelector('input').value = UPDATE_COMMAND;
    versionDialog.querySelector('a').href = UPDATE_NOTES_URL;
    root.append(versionDialog);
    function placeMenu() {
      const menu = $('.tt-menu'); if (menu.hidden) return;
      menu.style.transform = '';
      const bounds = menu.getBoundingClientRect(), parent = root.getBoundingClientRect();
      const left = Math.max(parent.left + 8, 8), right = Math.min(parent.right - 8, innerWidth - 8);
      const x = Math.max(left, Math.min(bounds.left, right - bounds.width));
      menu.style.transform = `translateX(${x - bounds.left}px)`;
      menu.style.maxHeight = `${Math.max(44, Math.min(440, parent.bottom - bounds.top - 8, innerHeight - bounds.top - 8))}px`;
    }
    function renderUpdateInfo() {
      const remind = backendSeen && remindersEnabled && backendState.needsUpdate;
      updateDot.hidden = !remind;
      const badge = versionsButton.querySelector('.tt-update-label'); badge.hidden = !remind; badge.textContent = backendState.label;
      $('[data-action="menu"]').setAttribute('aria-label', remind ? `设置，${backendState.label}` : '设置');
      updateControls.querySelector('[role="switch"]').setAttribute('aria-checked', String(remindersEnabled));
      versionDialog.querySelector('[data-version="backend"]').textContent = backendSeen ? backendState.version : '尚未连接';
      versionDialog.querySelector('.tt-version-message').textContent = backendSeen ? backendState.message : '连接后可查看后端运行版本。';
      placeMenu();
    }
    function setBackendVersion(version) { backendSeen = true; backendState = backendUpdateState(version); renderUpdateInfo(); }
    const helpButton = updateControls.querySelector('.tt-update-help-button'), risk = updateControls.querySelector('.tt-update-risk');
    let helpPinned = false;
    function showRisk(show) { risk.hidden = !show; helpButton.setAttribute('aria-expanded', String(show)); placeMenu(); }
    updateControls.addEventListener('click', event => event.stopPropagation());
    updateControls.querySelector('[role="switch"]').onclick = () => {
      remindersEnabled = !remindersEnabled;
      try { saveUpdateReminderPreference(localStorage, remindersEnabled); } catch { /* Keep the session preference if storage is blocked. */ }
      renderUpdateInfo();
    };
    helpButton.onclick = () => { helpPinned = !helpPinned; showRisk(helpPinned); };
    helpButton.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showRisk(true); });
    helpButton.addEventListener('pointerleave', () => { if (!helpPinned) showRisk(false); });
    helpButton.addEventListener('focus', () => showRisk(true));
    helpButton.addEventListener('blur', () => { if (!helpPinned) showRisk(false); });
    async function copyUpdateCommand() {
      const button = versionDialog.querySelector('[data-action="copy-update-command"]'), input = versionDialog.querySelector('input');
      try { await navigator.clipboard.writeText(UPDATE_COMMAND); button.textContent = '已复制'; }
      catch {
        input.focus(); input.select();
        try { button.textContent = document.execCommand('copy') ? '已复制' : '请手动复制'; } catch { button.textContent = '请手动复制'; }
      }
    }
    renderUpdateInfo();
    const themeKey = 'tavern-playtime-theme';
    function setTheme(value, remember = false) {
      const theme = value === 'light' ? 'light' : 'dark';
      root.dataset.theme = theme; dialog.style.colorScheme = theme;
      themeOptions.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
      if (remember) { try { localStorage.setItem(themeKey, theme); } catch { /* A blocked preference store does not affect counting or theme switching. */ } }
    }
    let savedTheme = 'dark';
    try { savedTheme = localStorage.getItem(themeKey) || 'dark'; } catch { /* Default to the reviewed dark appearance. */ }
    setTheme(savedTheme);
    let today = Date.parse(localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone) + 'T00:00:00Z');
    let catalog = [], records = [], currentStatus = { state: 'disconnected' };
    let scope = 'all';
    let expanded = null;
    let grain = 'day';
    let offset = 0;
    let selected = null;
    let detailIndex = null;
    let buckets = [];
    const MAX_VISIBLE_ROLES = 10;
    const MIN_VISIBLE_SHARE = .01;
    const BAR_COLORS = ['--tt-s1', '--tt-s2', '--tt-s3', '--tt-s5', '--tt-s6', '--tt-s7', '--tt-s8', '--tt-s9', '--tt-s10', '--tt-s11'];
    let displaySeries = [];
    let chartGeometry = null;
    const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const parseDate = value => Date.parse(value + 'T00:00:00Z');
    const dateShort = time => { const d = new Date(time); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
    const dateFull = time => new Date(time).toISOString().slice(0, 10).replaceAll('-', '/');
    const plainDuration = minutes => { const m = Math.round(minutes); return `${Math.floor(m / 60)}小时${m % 60}分钟`; };
    const compactDuration = minutes => { const m = Math.round(minutes); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') + 'm' : ''}` : `${m}m`; };
    const numberDuration = minutes => { const m = Math.round(minutes); return `${Math.floor(m / 60)}<span class="tt-unit">小时</span>${m % 60}<span class="tt-unit">分</span>`; };
    const roleFor = id => catalog.find(role => role.id === id);
    const selectedRole = () => scope === 'all' ? null : roleFor(scope.split(':')[0]);
    const selectedChat = () => scope.includes(':') ? selectedRole()?.chats.find(chat => chat.id === scope.split(':')[1]) : null;
    const matchesScope = record => scope === 'all' || (scope.includes(':') ? `${record.role}:${record.chat}` === scope : record.role === scope);
    const excludingOther = () => scope === 'all' && excludeOther;
    const visibleRecord = record => !excludingOther() || record.role !== 'other';
    const sum = (filter = () => true) => records.reduce((total, record) => total + (visibleRecord(record) && filter(record) ? record.minutes : 0), 0);
    function startOfWeek(time) { const d = new Date(time); return time - ((d.getUTCDay() + 6) % 7) * DAY; }
    function monthTime(index) { return Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth() + index, 1); }
    function makeBuckets() {
      const list = [];
      const count = grain === 'day' ? 7 : grain === 'week' ? 8 : 4;
      for (let i = 0; i < count; i++) {
        let start, end, label;
        if (grain === 'day') { start = today - (6 - i + offset * 7) * DAY; end = start + DAY; label = dateShort(start); }
        else if (grain === 'week') { start = startOfWeek(today) - (7 - i + offset * 8) * 7 * DAY; end = start + 7 * DAY; label = dateShort(start); }
        else { start = monthTime(-3 + i - offset * 4); end = monthTime(-2 + i - offset * 4); label = `${new Date(start).getUTCMonth() + 1}月`; }
        list.push({ start, end, label, values: catalog.map(() => 0), value: 0, total: 0 });
      }
      const indices = new Map(catalog.map((role, i) => [role.id, i]));
      for (const record of records) {
        if (!visibleRecord(record)) continue;
        const time = parseDate(record.date), bucket = list.find(b => time >= b.start && time < b.end);
        if (!bucket) continue;
        const i = indices.get(record.role);
        if (i !== undefined) bucket.values[i] += record.minutes;
        bucket.total += record.minutes;
        if (matchesScope(record)) bucket.value += record.minutes;
      }
      return list;
    }
    function chooseSeries(currentBuckets, roles) {
      const totals = roles.map((role, index) => ({ ...role, sourceIndices: [index], value: currentBuckets.reduce((n, bucket) => n + bucket.values[index], 0) }));
      const grandTotal = totals.reduce((n, role) => n + role.value, 0);
      const visible = totals.filter(role => role.id !== 'other' && role.value > 0 && role.value >= grandTotal * MIN_VISIBLE_SHARE)
        .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, MAX_VISIBLE_ROLES);
      const kept = new Set(visible.map(role => role.id));
      const remainder = totals.filter(role => role.id !== 'other' && !kept.has(role.id));
      const series = visible.map((role, index) => ({ ...role, color: BAR_COLORS[index] }));
      if (remainder.some(role => role.value > 0)) series.push({ id: 'merged-other', name: '其他角色', color: '--tt-s4', sourceIndices: remainder.flatMap(role => role.sourceIndices) });
      const unassigned = totals.find(role => role.id === 'other');
      if (!excludingOther() && unassigned?.value > 0) series.push({ ...unassigned, color: '--tt-unassigned' });
      return series;
    }
    function adaptiveAxis(maxMinutes) {
      const unit = maxMinutes >= 120 ? 60 : 1;
      const padded = Math.max(maxMinutes / unit * 1.12, unit === 1 ? 5 : .25);
      const rough = padded / 4;
      const magnitude = 10 ** Math.floor(Math.log10(rough));
      const multiple = [1, 2, 2.5, 5, 10].find(value => value * magnitude >= rough) || 10;
      const step = multiple * magnitude;
      const count = Math.ceil(padded / step);
      return { maximum: step * count * unit, ticks: Array.from({ length: count + 1 }, (_, i) => i * step * unit), unit };
    }
    function pchipPath(points) {
      if (!points.length) return '';
      if (points.length === 1) return `M${points[0].x},${points[0].y}`;
      const h = [], delta = [], slopes = new Array(points.length).fill(0);
      for (let i = 0; i < points.length - 1; i++) {
        h.push(points[i + 1].x - points[i].x);
        delta.push((points[i + 1].y - points[i].y) / h[i]);
      }
      if (points.length === 2) slopes[0] = slopes[1] = delta[0];
      else {
        const endpoint = (h0, h1, d0, d1) => {
          let derivative = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
          if (Math.sign(derivative) !== Math.sign(d0)) derivative = 0;
          else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(derivative) > 3 * Math.abs(d0)) derivative = 3 * d0;
          return derivative;
        };
        slopes[0] = endpoint(h[0], h[1], delta[0], delta[1]);
        const last = delta.length - 1;
        slopes[points.length - 1] = endpoint(h[last], h[last - 1], delta[last], delta[last - 1]);
        for (let i = 1; i < points.length - 1; i++) {
          if (delta[i - 1] * delta[i] <= 0) continue;
          const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
          slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
        }
      }
      let result = `M${points[0].x},${points[0].y}`;
      for (let i = 0; i < points.length - 1; i++) {
        result += ` C${points[i].x + h[i] / 3},${points[i].y + slopes[i] * h[i] / 3} ${points[i + 1].x - h[i] / 3},${points[i + 1].y - slopes[i + 1] * h[i] / 3} ${points[i + 1].x},${points[i + 1].y}`;
      }
      return result;
    }
    function saveState() {}
    function sidebar() {
      let html = `<button type="button" class="tt-nav cursor-interaction ${scope === 'all' ? 'is-active' : ''}" data-scope="all" aria-pressed="${scope === 'all'}"><span class="tt-nav-name">酒馆总览</span><span class="tt-nav-time">${compactDuration(sum())}</span></button><div class="tt-separator"></div>`;
      for (const role of catalog) {
        const time = excludingOther() && role.id === 'other' ? '' : `<span class="tt-nav-time">${compactDuration(role.total || 0)}</span>`;
        html += `<button type="button" class="tt-nav cursor-interaction ${scope === role.id ? 'is-active' : ''}" data-scope="${esc(role.id)}" aria-pressed="${scope === role.id}" aria-expanded="${expanded === role.id}" title="${esc(role.name)}"><span class="tt-nav-name">${esc(role.name)}</span>${time}</button>`;
        if (expanded === role.id) {
          html += '<div class="tt-children">';
          for (const chat of role.chats) {
            const id = `${role.id}:${chat.id}`;
            html += `<button type="button" class="tt-nav tt-child cursor-interaction ${scope === id ? 'is-active' : ''}" data-scope="${esc(id)}" aria-pressed="${scope === id}" title="${esc(chat.name)}"><span class="tt-nav-name">${esc(chat.name)}</span><span class="tt-nav-time">${compactDuration(chat.total || 0)}</span></button>`;
          }
          html += '</div>';
        }
      }
      $('.tt-sidebar-list').innerHTML = html;
    }
    function hideSelection() { selected = null; detailIndex = null; pop.hidden = true; pop.classList.remove('tt-bar-details'); pop.setAttribute('aria-label', '选中数据'); }
    function render() {
      hideSelection();
      if (scope !== 'all' && (!selectedRole() || (scope.includes(':') && !selectedChat()))) scope = 'all';
      excludeSwitch.hidden = scope !== 'all'; excludeSwitch.setAttribute('aria-checked', String(excludeOther));
      buckets = makeBuckets();
      displaySeries = chooseSeries(buckets, catalog);
      buckets.forEach(bucket => { bucket.displayValues = displaySeries.map(series => series.sourceIndices.reduce((n, index) => n + bucket.values[index], 0)); });
      sidebar();
      const role = selectedRole(), chat = selectedChat();
      $('.tt-heading').textContent = chat?.name || role?.name || '酒馆总览';
      heading.title = heading.textContent;
      if (role) { heading.dataset.fullName = heading.textContent; heading.tabIndex = 0; heading.setAttribute('role', 'button'); }
      else { delete heading.dataset.fullName; heading.removeAttribute('tabindex'); heading.removeAttribute('role'); }
      $('.tt-breadcrumb').innerHTML = scope === 'all' ? '<span>全部记录</span>' : `<button type="button" class="cursor-interaction" data-scope="all">酒馆</button><span>／</span>${chat ? `<button type="button" class="cursor-interaction" data-scope="${esc(role.id)}">${esc(role.name)}</button><span>／</span><span>${esc(chat.name)}</span>` : `<span>${esc(role.name)}</span>`}`;
      $('.tt-breadcrumb').querySelectorAll('[data-scope],span:last-child').forEach(el => {
        el.title = el.textContent;
        if (role && !el.dataset.scope) { el.dataset.fullName = el.textContent; el.tabIndex = 0; el.setAttribute('role', 'button'); }
      });
      const start = buckets[0].start, end = Math.min(buckets.at(-1).end - DAY, today);
      const periodTotal = sum(r => matchesScope(r) && parseDate(r.date) >= start && parseDate(r.date) <= end);
      const todayTotal = sum(r => matchesScope(r) && parseDate(r.date) === today);
      $('.tt-metrics').innerHTML = [['累计时长', sum(matchesScope)], ['所选时段', periodTotal], ['今日', todayTotal]].map(([label, value]) => `<div class="tt-metric"><div class="tt-metric-label">${label}</div><div class="tt-metric-value">${numberDuration(value)}</div></div>`).join('');
      $('.tt-period-label').textContent = `${dateFull(start)} — ${dateFull(end)}`;
      const visibleRecords = records.filter(visibleRecord);
      const firstDate = visibleRecords.length ? Math.min(...visibleRecords.map(r => parseDate(r.date))) : today;
      $('[data-action="prev"]').disabled = start <= firstDate;
      $('[data-action="next"]').disabled = offset === 0;
      root.querySelectorAll('[data-grain]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.grain === grain)));
      const legendSeries = scope === 'all' ? displaySeries : [{ name: chat?.name || role.name, color: '--tt-curve' }];
      $('.tt-legend').innerHTML = legendSeries.map(series => `<button type="button" class="tt-legend-item" data-full-name="${esc(series.name)}" title="${esc(series.name)}"><span class="tt-swatch" style="background:var(${series.color})"></span><span class="tt-legend-name">${esc(series.name)}</span></button>`).join('');
      const visibleCatalog = catalog.filter(role => !excludingOther() || role.id !== 'other');
      $('[data-record-count]').textContent = `${visibleCatalog.filter(r => r.id !== 'other').length} 张角色卡 · ${visibleCatalog.reduce((n, r) => n + r.chats.length, 0)} 项记录`;
      layoutMetrics(); layoutLegend(); drawChart();
    }
    function svgElement(tag, attrs = {}, text) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
      if (text !== undefined) el.textContent = text;
      return el;
    }
    function drawChart() {
      const width = Math.max(200, chart.clientWidth);
      const height = chart.clientHeight;
      const left = 42, right = 8, top = width < 400 && scope === 'all' ? 75 : 38, bottom = 42;
      const plotWidth = width - left - right, plotHeight = height - top - bottom;
      const maxValue = Math.max(0, ...buckets.map(b => scope === 'all' ? b.total : b.value));
      const { maximum, ticks, unit } = adaptiveAxis(maxValue);
      const y = value => top + plotHeight * (1 - value / maximum);
      const step = plotWidth / buckets.length;
      const x = index => left + step * (index + .5);
      chartGeometry = { width, height, top, left, plotWidth, plotHeight, x, y, step };
      const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': scope === 'all' ? '按角色划分的游戏时长堆叠柱状图' : '游戏时长曲线图' });
      for (const value of ticks) {
        svg.append(svgElement('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), stroke: 'var(--tt-line)', 'stroke-width': 1 }));
        svg.append(svgElement('text', { x: left - 9, y: y(value) + 4, 'text-anchor': 'end', 'data-y-tick': value }, `${Number((value / unit).toFixed(2))}${unit === 60 ? 'h' : 'm'}`));
      }
      svg.append(svgElement('text', { x: 0, y: 17 }, '时长'));
      chart.replaceChildren(svg);
      buckets.forEach((bucket, i) => {
        if (scope === 'all') {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'tt-bucket-label'; button.dataset.bucketDetails = String(i);
          button.textContent = bucket.label; button.disabled = bucket.total <= 0;
          button.setAttribute('aria-label', `${bucketPeriod(bucket)} 分块明细，总时长${plainDuration(bucket.total)}`);
          Object.assign(button.style, { left: `${x(i) - step / 2}px`, top: `${height - 40}px`, width: `${step}px`, height: '40px', fontSize: width < 380 ? '10px' : '11px' });
          chart.append(button);
        } else svg.append(svgElement('text', { x: x(i), y: height - 17, 'text-anchor': 'middle' }, width < 380 && grain !== 'month' && i % 2 === 1 ? '' : bucket.label));
      });
      if (scope === 'all') {
        const barWidth = Math.min(45, step * .58);
        buckets.forEach((bucket, i) => {
          let below = 0;
          displaySeries.forEach((role, r) => {
            const value = bucket.displayValues[r];
            if (value > 0) {
              const rectTop = y(below + value), rectHeight = y(below) - rectTop;
              const mark = svgElement('rect', { x: x(i) - barWidth / 2, y: rectTop, width: barWidth, height: rectHeight, fill: `var(${role.color})`, 'data-mark': `${i}:${r}` });
              svg.append(mark);
              const button = document.createElement('button');
              button.type = 'button'; button.className = 'tt-hit cursor-interaction';
              button.dataset.bar = String(i); button.dataset.roleIndex = String(r);
              button.setAttribute('aria-label', `${bucket.label} ${role.name} ${plainDuration(value)} 占比${(value / bucket.total * 100).toFixed(1)}%`);
              Object.assign(button.style, { left: `${x(i) - barWidth / 2}px`, top: `${rectTop}px`, width: `${barWidth}px`, height: `${rectHeight}px` });
              chart.append(button);
            }
            below += value;
          });
          const attrs = { x: x(i), y: y(bucket.total) - 9, 'text-anchor': 'middle', class: 'tt-bar-total' };
          if (width < 400) { attrs.transform = `rotate(-90 ${x(i)} ${y(bucket.total) - 9})`; attrs['text-anchor'] = 'start'; }
          svg.append(svgElement('text', attrs, compactDuration(bucket.total)));
        });
      } else {
        const color = '--tt-curve';
        const points = buckets.map((bucket, i) => ({ x: x(i), y: y(bucket.value) }));
        const path = pchipPath(points);
        svg.append(svgElement('path', { d: `${path} L${x(buckets.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, fill: `var(${color})`, opacity: '.09' }));
        svg.append(svgElement('path', { d: path, fill: 'none', stroke: `var(${color})`, 'stroke-width': '2.5', 'data-curve': 'pchip' }));
        buckets.forEach((bucket, i) => {
          svg.append(svgElement('circle', { cx: x(i), cy: y(bucket.value), r: 4, fill: `var(${color})`, 'data-point': i }));
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'tt-hit cursor-interaction'; button.dataset.pointIndex = String(i);
          button.setAttribute('aria-label', `${bucket.label} ${plainDuration(bucket.value)}`);
          const hitSize = Math.min(44, step);
          Object.assign(button.style, { left: `${x(i) - hitSize / 2}px`, top: `${y(bucket.value) - 22}px`, width: `${hitSize}px`, height: '44px', borderRadius: '50%' });
          chart.append(button);
        });
      }
      if (selected) paintSelection();
      else if (detailIndex !== null) paintBarDetails();
    }
    // Pack in catalog order at the initial cap, then let each row's last item use its free space.
    function layoutLegend() {
      const legend = $('.tt-legend'), width = legend.clientWidth;
      if (!width) return;
      const items = [...legend.querySelectorAll('.tt-legend-item')];
      const gap = 21, fontSize = parseFloat(getComputedStyle(legend).fontSize);
      const cap = scope === 'all' ? Math.min(20 * fontSize + 14, width / 2) : width;
      const rows = []; let row = [], used = 0;
      for (const item of items) {
        item.style.width = 'max-content';
        const natural = item.querySelector('.tt-legend-name').scrollWidth + 14;
        const size = Math.min(natural, cap);
        if (row.length && used + gap + size > width + .1) { rows.push({ items: row, used }); row = []; used = 0; }
        used += (row.length ? gap : 0) + size; row.push({ item, natural, size });
      }
      if (row.length) rows.push({ items: row, used });
      legend.replaceChildren(...rows.map(({ items, used }) => {
        const line = document.createElement('div'); line.className = 'tt-legend-row';
        const last = items.at(-1); last.size += Math.min(Math.max(0, last.natural - last.size), Math.max(0, width - used));
        items.forEach(({ item, size }) => { item.style.width = `${size}px`; line.append(item); });
        return line;
      }));
    }
    function layoutMetrics() {
      const metrics = $('.tt-metrics');
      metrics.classList.remove('tt-metrics-two', 'tt-metrics-one');
      const tooWide = () => [...metrics.querySelectorAll('.tt-metric')].some(el => el.querySelector('.tt-metric-value').scrollWidth > el.clientWidth + 1);
      if (tooWide()) metrics.classList.add('tt-metrics-two');
      if (tooWide()) { metrics.classList.remove('tt-metrics-two'); metrics.classList.add('tt-metrics-one'); }
    }
    function placePopover(anchor, avoid) {
      const rootRect = root.getBoundingClientRect(), dialogRect = dialog.getBoundingClientRect();
      const visibleTop = Math.max(8, dialogRect.top, rootRect.top) + 8;
      const visibleBottom = Math.min(window.innerHeight - 8, dialogRect.bottom, rootRect.bottom) - 8;
      pop.style.setProperty('--tt-popover-limit', `${Math.min(280, Math.max(80, visibleBottom - visibleTop))}px`);
      let left = anchor.x + 16, top = anchor.y - 25;
      if (avoid) {
        if (avoid.right + 8 + pop.offsetWidth <= rootRect.left + root.clientWidth - 10) left = avoid.right + 8;
        else if (avoid.left - 8 - pop.offsetWidth >= rootRect.left + 9) left = avoid.left - 8 - pop.offsetWidth;
        else {
          // Keep the triggering control available for a second click, including on narrow screens.
          const above = avoid.top - 8 - visibleTop, below = visibleBottom - avoid.bottom - 8;
          pop.style.setProperty('--tt-popover-limit', `${Math.max(44, Math.min(280, Math.max(above, below)))}px`);
          top = above >= below ? avoid.top - 8 - pop.offsetHeight : avoid.bottom + 8;
        }
      }
      pop.style.left = `${Math.max(9, Math.min(left - rootRect.left, root.clientWidth - pop.offsetWidth - 10))}px`;
      pop.style.top = `${Math.max(visibleTop, Math.min(top, visibleBottom - pop.offsetHeight)) - rootRect.top}px`;
    }
    function showFullName(target) {
      hideSelection(); drawChart();
      $('.tt-popover-content').innerHTML = `<div class="tt-popover-name">${esc(target.dataset.fullName)}</div>`;
      pop.hidden = false;
      const rect = target.getBoundingClientRect(); placePopover({ x: rect.left, y: rect.bottom + 25 });
    }
    function bucketPeriod(bucket) {
      const end = Math.min(bucket.end - DAY, today);
      return grain === 'day' ? dateFull(bucket.start) : `${dateFull(bucket.start)} — ${dateFull(end)}`;
    }
    function paintBarDetails() {
      const bucket = buckets[detailIndex];
      const tailOrder = id => id === 'merged-other' ? 1 : id === 'other' ? 2 : 0;
      const rows = displaySeries.map((series, roleIndex) => ({ series, roleIndex, value: bucket.displayValues[roleIndex] }))
        .filter(row => row.value > 0)
        .sort((a, b) => tailOrder(a.series.id) - tailOrder(b.series.id) || (tailOrder(a.series.id) ? 0 : b.value - a.value) || a.roleIndex - b.roleIndex)
        .map(({ series, roleIndex, value }) => {
        return `<div class="tt-detail-row" role="row"><div role="cell"><button type="button" class="tt-detail-name" data-bar="${detailIndex}" data-role-index="${roleIndex}" aria-label="选择${esc(series.name)}"><span class="tt-swatch" style="background:var(${series.color})" aria-hidden="true"></span><span class="tt-detail-label">${esc(series.name)}</span></button></div><div class="tt-detail-time" role="cell">${compactDuration(value)}</div><div class="tt-detail-share" role="cell">${(value / bucket.total * 100).toFixed(1)}%</div></div>`;
      }).join('');
      pop.classList.add('tt-bar-details'); pop.setAttribute('aria-label', '柱状图分块明细');
      $('.tt-popover-content').innerHTML = `<div class="tt-popover-name">${bucketPeriod(bucket)}</div><div class="tt-popover-date">合计 ${plainDuration(bucket.total)}</div><div class="tt-details-table" role="table" aria-label="分块明细"><div class="tt-detail-row tt-details-head" role="row"><div role="columnheader">名称</div><div class="tt-detail-time" role="columnheader">时长</div><div class="tt-detail-share" role="columnheader">占比</div></div>${rows}</div>`;
      pop.hidden = false;
      const rect = chart.getBoundingClientRect();
      placePopover({ x: rect.left + chartGeometry.x(detailIndex), y: rect.bottom }, chart.querySelector(`[data-bucket-details="${detailIndex}"]`).getBoundingClientRect());
    }
    function showBarDetails(index) {
      if (detailIndex === index && !pop.hidden) { hideSelection(); drawChart(); return; }
      hideSelection(); detailIndex = index; drawChart();
      pop.querySelector('.tt-detail-name')?.focus({ preventScroll: true });
    }
    function paintSelection() {
      detailIndex = null; pop.classList.remove('tt-bar-details'); pop.setAttribute('aria-label', '选中数据');
      const { index, roleIndex } = selected;
      chart.querySelectorAll('[data-mark]').forEach(el => el.setAttribute('opacity', el.getAttribute('data-mark') === `${index}:${roleIndex}` ? '1' : '.3'));
      chart.querySelectorAll('[data-point]').forEach(el => { el.setAttribute('r', Number(el.getAttribute('data-point')) === index ? '7' : '4'); el.setAttribute('opacity', Number(el.getAttribute('data-point')) === index ? '1' : '.5'); });
      const bucket = buckets[index];
      const role = roleIndex === null ? selectedRole() : displaySeries[roleIndex];
      const name = roleIndex === null ? (selectedChat()?.name || role.name) : role.name;
      const value = roleIndex === null ? bucket.value : bucket.displayValues[roleIndex];
      const period = bucketPeriod(bucket);
      const share = roleIndex === null ? '' : `占比 ${(value / bucket.total * 100).toFixed(1)}%`;
      $('.tt-popover-content').innerHTML = `<div class="tt-popover-name">${esc(name)}</div><div class="tt-popover-date">${period}</div><div class="tt-popover-value">${plainDuration(value)}</div>${share ? `<div class="tt-popover-share">${share}</div>` : ''}`;
      pop.hidden = false;
      const rootRect = root.getBoundingClientRect(), chartRect = chart.getBoundingClientRect();
      const pointX = chartRect.left - rootRect.left + chartGeometry.x(index);
      const above = roleIndex === null ? value : bucket.displayValues.slice(0, roleIndex + 1).reduce((a, b) => a + b, 0);
      const pointY = chartRect.top - rootRect.top + chartGeometry.y(above);
      const hit = chart.querySelector(roleIndex === null ? `[data-point-index="${index}"]` : `[data-bar="${index}"][data-role-index="${roleIndex}"]`);
      placePopover({ x: rootRect.left + pointX, y: rootRect.top + pointY }, hit?.getBoundingClientRect());
    }
    root.addEventListener('click', event => {
      const fullName = event.target.closest('[data-full-name]');
      if (fullName) { showFullName(fullName); $('.tt-menu').hidden = true; $('[data-action="menu"]').setAttribute('aria-expanded', 'false'); return; }
      const target = event.target.closest('button');
      if (!target) {
        if (!event.target.closest('.tt-popover')) { hideSelection(); drawChart(); }
        $('.tt-menu').hidden = true; $('[data-action="menu"]').setAttribute('aria-expanded', 'false');
        return;
      }
      if (target.dataset.theme) { setTheme(target.dataset.theme, true); }
      else if (target.dataset.action === 'exclude-other') {
        excludeOther = !excludeOther;
        try { localStorage.setItem(excludeKey, String(excludeOther)); } catch { /* The display toggle also works without storage. */ }
        render();
      }
      else if (target.dataset.scope) {
        scope = target.dataset.scope;
        const parentClick = target.classList.contains('tt-nav') && !target.classList.contains('tt-child') && scope !== 'all';
        expanded = parentClick && expanded === scope ? null : scope === 'all' ? null : scope.split(':')[0];
        render(); saveState();
      } else if (target.dataset.grain) { grain = target.dataset.grain; offset = 0; render(); saveState(); }
      else if (target.dataset.bucketDetails !== undefined) { showBarDetails(Number(target.dataset.bucketDetails)); }
      else if (target.dataset.bar !== undefined || target.dataset.pointIndex !== undefined) {
        const next = { index: Number(target.dataset.bar ?? target.dataset.pointIndex), roleIndex: target.dataset.roleIndex !== undefined ? Number(target.dataset.roleIndex) : null };
        if (selected?.index === next.index && selected?.roleIndex === next.roleIndex) { hideSelection(); drawChart(); }
        else { selected = next; paintSelection(); }
      } else if (target.dataset.action === 'prev') { offset++; render(); saveState(); }
      else if (target.dataset.action === 'next') { offset = Math.max(0, offset - 1); render(); saveState(); }
      else if (target.dataset.action === 'dismiss') { dialog.close(); }
      else if (target.dataset.action === 'export') { onExport(); }
      else if (target.dataset.action === 'import') { onImport(); }
      else if (target.dataset.action === 'reset') { onReset(); }
      else if (target.dataset.action === 'versions') { versionDialog.querySelector('[data-action="copy-update-command"]').textContent = '复制命令'; renderUpdateInfo(); versionDialog.showModal(); }
      else if (target.dataset.action === 'version-close') { versionDialog.close(); }
      else if (target.dataset.action === 'copy-update-command') { void copyUpdateCommand(); }
      else if (target.dataset.action === 'close') { hideSelection(); drawChart(); }
      else if (target.dataset.action === 'menu') {
        helpPinned = false; showRisk(false);
        $('.tt-menu').hidden = !$('.tt-menu').hidden; target.setAttribute('aria-expanded', String(!$('.tt-menu').hidden)); placeMenu(); return;
      }
      if (!target.closest('.tt-popover')) { $('.tt-menu').hidden = true; $('[data-action="menu"]').setAttribute('aria-expanded', 'false'); }
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (!pop.hidden || !$('.tt-menu').hidden) event.preventDefault();
        hideSelection(); drawChart(); $('.tt-menu').hidden = true;
        $('[data-action="menu"]').setAttribute('aria-expanded', 'false'); helpPinned = false; showRisk(false);
      }
      if (['Enter', ' '].includes(event.key) && event.target.matches('[data-full-name]:not(button)')) { event.preventDefault(); showFullName(event.target); }
    });
    render();
    const observer = new ResizeObserver(() => { if (chart.clientWidth) { layoutMetrics(); layoutLegend(); drawChart(); } placeMenu(); }); observer.observe(chart);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    const setStatus = status => {
      currentStatus = status;
      const el = $('.tt-status');
      el.innerHTML = '<span class="tt-dot"></span>' + ({ active: '计时中', paused: '已暂停', waiting: '等待中', disconnected: '未连接' }[status.state] || '未连接');
      el.style.color = status.state === 'active' ? 'var(--tt-green)' : 'var(--tt-muted)';
    };
    setStatus(currentStatus);
    return {
      open() { if (!dialog.open) dialog.showModal(); layoutMetrics(); layoutLegend(); drawChart(); },
      close() { dialog.close(); }, isOpen() { return dialog.open; }, setStatus, setBackendVersion,
      confirmReset() {
        resetDialog.querySelector('input').checked = true;
        return new Promise(resolve => { finishReset = resolve; resetDialog.showModal(); });
      },
      confirmImport() { return new Promise(resolve => { finishImport = resolve; importDialog.showModal(); }); },
      update(snapshot) {
        const report = reportData(snapshot); catalog = report.catalog; records = report.records; today = report.today;
        $('.tt-footer span').textContent = report.timeZone; setStatus(snapshot.server); setBackendVersion(snapshot.server?.backendVersion); render();
      },
      destroy() { if (resetDialog.open) resetDialog.close(); if (importDialog.open) importDialog.close(); if (versionDialog.open) versionDialog.close(); observer.disconnect(); dialog.remove(); }
    };

}
