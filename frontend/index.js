import { createView } from './view.mjs';
import { exportFileName } from './data.mjs';

const API = '/api/plugins/tavern-playtime';
let running = null;
const getContext = () => window.SillyTavern.getContext();
function windowId() {
  return 'w_' + [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function createSettingsEntry(container, onOpen) {
  const button = document.createElement('button');
  button.id = 'tavern-playtime-settings-entry'; button.type = 'button';
  button.className = 'standoutHeader inline-drawer-header';
  button.innerHTML = '<b>酒馆时长</b><i class="fa-solid fa-circle-chevron-right" aria-hidden="true"></i>';
  button.addEventListener('click', onOpen); container.append(button);
  return button;
}
export function describeContext(context, sessionId) {
  const chatName = context.getCurrentChatId?.() || context.chatId;
  if (context.groupId) return { kind: 'group', groupId: String(context.groupId), chatName, name: context.groups?.find(g => String(g.id) === String(context.groupId))?.name || '群聊' };
  const character = context.characters?.[context.characterId];
  if (character?.avatar && chatName) return { kind: 'solo', avatar: character.avatar, roleName: character.name, chatName, integrity: context.chatMetadata?.integrity || '' };
  if (!character) {
    const messages = context.chat || [];
    if (messages.some(message => ['welcome', 'welcome_prompt'].includes(message?.extra?.type))) return { kind: 'lobby' };
    if (messages.some(message => message?.extra?.type === 'assistant_note')) return { kind: 'temporary', sessionId };
  }
  return { kind: 'lobby' };
}
export function createContextReader(sessionId) {
  const temporarySessions = new WeakMap();
  let sequence = 0;
  return context => {
    const target = describeContext(context, sessionId);
    if (target.kind === 'temporary') {
      const note = context.chat.find(message => message?.extra?.type === 'assistant_note');
      if (!temporarySessions.has(note)) temporarySessions.set(note, `${sessionId}_temporary_${++sequence}`);
      target.sessionId = temporarySessions.get(note);
    }
    return target;
  };
}
async function start() {
  if (running) return;
  const id = windowId(), context = getContext(), listeners = [];
  const readContext = createContextReader(id);
  let stopped = false, chain = Promise.resolve(), clearing = false;
  const reportError = error => window.toastr?.error(String(error.message || error), '酒馆时长');
  async function request(route, body, keepalive = false) {
    const response = await fetch(API + route, { method: body === undefined ? 'GET' : 'POST', headers: getContext().getRequestHeaders(), body: body === undefined ? undefined : JSON.stringify(body), keepalive, signal: keepalive ? undefined : AbortSignal.timeout(15_000) });
    if (!response.ok) {
      let error; try { error = (await response.json()).error; } catch { /* Native errors may not be JSON. */ }
      throw new Error(error || (response.status === 404 ? '请安装酒馆时长服务端插件。' : '统计请求失败。'));
    }
    return response.json();
  }
  const view = createView({
    onExport: () => void request('/export').then(download).catch(reportError),
    onReset: () => void resetAll().catch(reportError),
    onImport: () => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
      input.addEventListener('change', () => void (async () => {
        const file = input.files[0]; if (!file) return;
        if (file.size > 32 * 1024 * 1024) throw new Error('导入文件超过 32 MB。');
        const data = JSON.parse(await file.text());
        if (!await view.confirmImport()) return;
        await request('/import', data); await refresh();
        window.toastr?.success('数据已导入。', '酒馆时长');
      })().catch(reportError), { once: true });
      input.click();
    }
  });
  function download(data) {
    const name = exportFileName(data);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function resetAll() {
    if (clearing) return;
    clearing = true;
    try {
      const choice = await view.confirmReset();
      if (!choice.confirmed) return;
      const result = await request('/reset', choice);
      if (result.backup) download(result.backup);
      await refresh(); window.toastr?.success('已清除全部时长数据。', '酒馆时长');
    } finally { clearing = false; }
  }
  async function refresh() {
    const data = await request('/data?windowId=' + encodeURIComponent(id)); view.update(data);
  }
  function enqueue(action) {
    chain = chain.catch(() => {}).then(() => stopped ? undefined : action()).catch(() => { view.setStatus({ state: 'disconnected' }); });
    return chain;
  }
  const readFocus = () => document.hasFocus() && document.visibilityState !== 'hidden';
  function heartbeat(focused = readFocus()) {
    if (stopped) return;
    // Capture the minimum identity fields now; never serialize chat messages or settings.
    const target = readContext(getContext());
    return enqueue(async () => { const status = await request('/heartbeat', { windowId: id, context: target, focused, legacyChatRename: !context.eventTypes.CHAT_RENAMED }); view.setStatus(status); view.setBackendVersion(status.backendVersion); if (view.isOpen()) await refresh(); });
  }
  function listen(event, callback) {
    if (!event) return;
    context.eventSource.on(event, callback); listeners.push([event, callback]);
  }
  function lifecycle(event) {
    return enqueue(async () => { await request('/lifecycle', event); if (view.isOpen()) await refresh(); });
  }
  listen(context.eventTypes.CHAT_CHANGED, () => { void heartbeat(); });
  listen(context.eventTypes.CHAT_CREATED, () => { void heartbeat(); });
  listen(context.eventTypes.CHARACTER_EDITED, () => { void heartbeat(); });
  let temporaryClickTimer;
  const onTemporaryChatClick = event => {
    if (!event.target?.closest?.('.openTemporaryChat')) return;
    // Native newAssistantChat inserts assistant_note after asynchronously clearing the welcome page.
    clearTimeout(temporaryClickTimer); temporaryClickTimer = setTimeout(() => void heartbeat(), 250);
  };
  document.addEventListener('click', onTemporaryChatClick);
  listen(context.eventTypes.CHAT_RENAMED, event => {
    if (event.groupId) return;
    void lifecycle({ kind: 'chat-rename', avatar: event.avatarId, oldName: event.oldFileName, newName: event.newFileName });
  });
  listen(context.eventTypes.CHARACTER_RENAMED, (oldAvatar, newAvatar) => { void lifecycle({ kind: 'role-rename', oldAvatar, newAvatar }); });
  listen(context.eventTypes.CHAT_DELETED, name => {
    const current = getContext(), character = current.characters?.[current.characterId];
    if (character) void lifecycle({ kind: 'chat-delete', avatar: character.avatar, oldName: name });
  });
  listen(context.eventTypes.CHARACTER_DELETED, event => { if (event.character?.avatar) void lifecycle({ kind: 'role-delete', avatar: event.character.avatar }); });
  async function open() { view.open(); try { await chain; await refresh(); } catch (error) { reportError(error); } }
  const settings = document.querySelector('#extensions_settings');
  let settingsEntry;
  if (settings) settingsEntry = createSettingsEntry(settings, () => void open());
  const openEvent = () => void open(); window.addEventListener('tavern-playtime-open', openEvent);
  const resume = () => { stopped = false; void heartbeat(); };
  window.addEventListener('pageshow', resume);
  const onFocus = () => void heartbeat();
  const onBlur = () => void heartbeat(false);
  const onVisibility = () => void heartbeat();
  window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  const release = () => {
    stopped = true;
    void request('/release', { windowId: id }, true).catch(() => {});
  };
  window.addEventListener('pagehide', release);
  const timer = setInterval(() => void heartbeat(), 60_000);
  running = { stop() {
    release(); clearInterval(timer); clearTimeout(temporaryClickTimer);
    document.removeEventListener('click', onTemporaryChatClick);
    for (const [event, callback] of listeners) context.eventSource.removeListener(event, callback);
    window.removeEventListener('pageshow', resume); window.removeEventListener('pagehide', release); window.removeEventListener('tavern-playtime-open', openEvent);
    window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVisibility);
    settingsEntry?.remove(); view.destroy(); running = null;
  } };
  void heartbeat();
}
export function onDisable() { running?.stop(); }
export function onDelete() { running?.stop(); }
export function onEnable() { void start(); }
if (typeof window !== 'undefined' && window.SillyTavern?.getContext) {
  const context = getContext();
  if (context.eventSource && context.eventTypes?.APP_READY) context.eventSource.on(context.eventTypes.APP_READY, () => { void start(); });
  else void start();
}
