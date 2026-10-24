import { randomUUID } from 'node:crypto';

export const SCHEMA = 'sillytavern-playtime';
export const LEASE_MS = 180_000;
export const FOCUS_PAUSE_MS = 30 * 60_000;
export const uuid = () => randomUUID();
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;
const fileName = value => String(value || '').replace(/\.jsonl$/i, '').slice(0, 300);
const text = value => String(value || '').slice(0, 300);
export const emptyData = (createdAt = Date.now()) => ({ schema: SCHEMA, version: 1, createdAt, roles: [], chats: [], segments: [] });
export function formatExportFileName(data) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: data.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = formatter.formatToParts(data.exportedAt), start = formatter.formatToParts(data.createdAt);
  const get = (list, type) => list.find(part => part.type === type).value;
  const ms = String(new Date(data.exportedAt).getUTCMilliseconds()).padStart(3, '0');
  const time = `${get(parts,'year')}-${get(parts,'month')}-${get(parts,'day')}@${get(parts,'hour')}h${get(parts,'minute')}m${get(parts,'second')}s${ms}ms`;
  const date = `${get(start,'year')}-${get(start,'month')}-${get(start,'day')}`;
  return `酒馆时长数据 - ${time} - 起始${date}.json`;
}

export function validateData(input) {
  if (input?.schema !== SCHEMA || input.version !== 1 || !Array.isArray(input.roles) || !Array.isArray(input.chats) || !Array.isArray(input.segments)) throw new Error('数据格式不匹配。');
  if (input.roles.length > 10_000 || input.chats.length > 50_000 || input.segments.length > 200_000) throw new Error('数据量超过本 demo 的导入上限。');
  const roles = new Set(), chats = new Set(), segments = new Set();
  for (const r of input.roles) {
    if (!identifier.test(r.id) || roles.has(r.id) || typeof r.name !== 'string' || typeof r.avatar !== 'string' || !Array.isArray(r.aliases) || r.aliases.some(a => typeof a !== 'string')) throw new Error('角色记录无效。');
    roles.add(r.id);
  }
  for (const c of input.chats) {
    if (!identifier.test(c.id) || chats.has(c.id) || typeof c.name !== 'string' || typeof c.key !== 'string' || !['solo', 'temporary', 'lobby', 'group'].includes(c.kind) || (c.roleId !== null && !roles.has(c.roleId)) || (c.kind === 'solo' && c.roleId === null)) throw new Error('聊天记录无效。');
    chats.add(c.id);
  }
  for (const s of input.segments) {
    if (!identifier.test(s.id) || segments.has(s.id) || !chats.has(s.chatId) || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || s.end - s.start > 86_400_000) throw new Error('计时记录无效。');
    segments.add(s.id);
  }
  // Select fields explicitly: imports never supply paths, configuration, or runtime queues.
  return {
    schema: SCHEMA, version: 1, createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    roles: input.roles.map(r => ({ id: r.id, name: text(r.name), avatar: text(r.avatar), aliases: r.aliases.slice(0, 100).map(text), deleted: Boolean(r.deleted) })),
    chats: input.chats.map(c => ({ id: c.id, roleId: c.roleId, kind: c.kind, name: text(c.name), key: text(c.key), integrity: text(c.integrity), deleted: Boolean(c.deleted) })),
    segments: input.segments.map(s => ({ id: s.id, chatId: s.chatId, start: s.start, end: s.end }))
  };
}

export class Tracker {
  constructor(data = emptyData(), { wall = () => Date.now(), mono = () => performance.now(), timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone, leaseMs = LEASE_MS } = {}) {
    this.data = validateData(data);
    this.clock = { wall, mono, timeZone };
    this.leaseMs = leaseMs;
    this.windows = new Map();
    this.lastMono = mono();
    this.sequence = 0;
    this.mutableId = null;
    this.dirty = false;
  }
  addTime(chatId, start, end) {
    if (end <= start) return;
    const last = this.data.segments.at(-1);
    if (last?.id === this.mutableId && last.chatId === chatId && Math.abs(last.end - start) < 2 && end - last.start <= 300_000) last.end = end;
    else {
      const segment = { id: uuid(), chatId, start, end };
      this.data.segments.push(segment); this.mutableId = segment.id;
    }
    this.dirty = true;
  }
  ownerAt(time) {
    const owner = [...this.windows.values()].filter(w => w.seen + this.leaseMs > time).sort((a, b) => a.order - b.order)[0];
    if (owner && owner.ownedSince === null) owner.ownedSince = time;
    return owner;
  }
  pauseDeadline(window) {
    return window.focused ? Infinity : Math.max(window.unfocusedSince, window.ownedSince) + FOCUS_PAUSE_MS;
  }
  advance() {
    const now = this.clock.mono(), wall = this.clock.wall();
    let cursor = this.lastMono;
    // The server owns the single queue; waiting windows never add a second duration.
    while (cursor < now) {
      const owner = this.ownerAt(cursor);
      if (!owner) break;
      const end = Math.min(now, owner.seen + this.leaseMs);
      const countedEnd = Math.min(end, this.pauseDeadline(owner));
      if (countedEnd > cursor) this.addTime(owner.chatId, wall - (now - cursor), wall - (now - countedEnd));
      // A paused owner keeps its queue position. Advance through the gap without adding time.
      cursor = end;
    }
    this.lastMono = now;
    for (const [id, w] of this.windows) if (w.seen + this.leaseMs <= now) this.windows.delete(id);
    this.ownerAt(now);
  }
  role(avatar, name) {
    avatar = text(avatar);
    if (!avatar || /[/\\\x00]/.test(avatar)) throw new Error('角色标识无效。');
    let role = this.data.roles.find(r => !r.deleted && r.avatar === avatar);
    if (!role) {
      role = { id: uuid(), avatar, name: text(name || avatar.replace(/\.png$/i, '')), aliases: [], deleted: false };
      this.data.roles.push(role); this.dirty = true;
    } else if (name && avatar === role.avatar && role.name !== text(name)) { role.name = text(name); this.dirty = true; }
    return role;
  }
  target(context = {}, windowId) {
    const kind = ['solo', 'temporary', 'group'].includes(context.kind) ? context.kind : 'lobby';
    let roleId = null, key, name;
    if (kind === 'solo') {
      roleId = this.role(context.avatar, context.roleName).id;
      key = fileName(context.chatName);
      if (!key) throw new Error('聊天标识无效。');
      name = key;
    } else if (kind === 'temporary') { key = text(context.sessionId || windowId); name = text(context.name || `临时聊天 · ${new Date(this.clock.wall()).toLocaleString('zh-CN')}`); }
    else if (kind === 'group') { key = text(context.groupId) + ':' + fileName(context.chatName); name = text(context.name || context.chatName || '群聊'); }
    else { key = 'lobby'; name = '主界面'; }
    const integrity = kind === 'solo' ? text(context.integrity) : '';
    let chat = this.data.chats.find(c => !c.deleted && c.kind === kind && c.roleId === roleId && c.key === key);
    if (chat && integrity && chat.integrity && integrity !== chat.integrity) {
      chat.deleted = true; chat = null; this.dirty = true;
    }
    if (!chat) {
      chat = { id: uuid(), roleId, kind, key, name, integrity, deleted: false };
      this.data.chats.push(chat); this.dirty = true;
    } else if (!chat.integrity && integrity) { chat.integrity = integrity; this.dirty = true; }
    return chat.id;
  }
  heartbeat({ windowId, context, focused }) {
    if (!identifier.test(windowId)) throw new Error('窗口标识无效。');
    this.advance();
    const chatId = this.target(context, windowId);
    const existing = this.windows.get(windowId);
    const now = this.clock.mono();
    // Missing focus data from an older page keeps its previous state, or defaults to focused.
    const hasFocus = typeof focused === 'boolean' ? focused : existing?.focused ?? true;
    this.windows.set(windowId, { id: windowId, order: existing?.order ?? ++this.sequence, seen: now, chatId,
      focused: hasFocus, unfocusedSince: hasFocus ? null : existing?.focused === false ? existing.unfocusedSince : now,
      ownedSince: existing?.ownedSince ?? null });
    this.ownerAt(now);
    return this.status(windowId);
  }
  release(windowId) { this.advance(); this.windows.delete(windowId); this.ownerAt(this.clock.mono()); return this.status(windowId); }
  status(windowId) {
    const queue = [...this.windows.values()].sort((a, b) => a.order - b.order);
    const index = queue.findIndex(w => w.id === windowId);
    const paused = index === 0 && this.clock.mono() >= this.pauseDeadline(queue[0]);
    return { state: index === 0 ? (paused ? 'paused' : 'active') : index > 0 ? 'waiting' : 'disconnected', position: index + 1, activeWindowId: queue[0]?.id || null, windows: queue.length, now: this.clock.wall(), timeZone: this.clock.timeZone(), heartbeatMs: 60_000, focusPauseMs: FOCUS_PAUSE_MS };
  }
  lifecycle(event) {
    this.advance();
    const role = this.data.roles.find(r => !r.deleted && r.avatar === event.avatar);
    if (event.kind === 'role-rename') {
      const original = this.data.roles.find(r => !r.deleted && r.avatar === event.oldAvatar);
      if (original) {
        original.aliases.push(original.avatar); original.avatar = text(event.newAvatar);
        original.name = text(event.name || event.newAvatar?.replace(/\.png$/i, '')); this.dirty = true;
      }
    } else if (event.kind === 'chat-rename' || event.kind === 'chat-delete') {
      const chat = this.data.chats.find(c => !c.deleted && c.roleId === role?.id && c.key === fileName(event.oldName));
      if (chat) {
        if (event.kind === 'chat-delete') chat.deleted = true;
        else {
          const newKey = fileName(event.newName);
          // Native rename reloads the new name before emitting CHAT_RENAMED.
          const provisional = this.data.chats.find(c => c.id !== chat.id && !c.deleted && c.roleId === chat.roleId && c.key === newKey);
          if (provisional && (!provisional.integrity || !chat.integrity || provisional.integrity === chat.integrity)) {
            this.data.segments.forEach(s => { if (s.chatId === provisional.id) s.chatId = chat.id; });
            for (const w of this.windows.values()) if (w.chatId === provisional.id) w.chatId = chat.id;
            this.data.chats = this.data.chats.filter(c => c.id !== provisional.id);
          }
          chat.key = newKey; chat.name = newKey;
        }
        this.dirty = true;
      }
    } else if (event.kind === 'role-delete' && role) {
      role.deleted = true;
      this.data.chats.filter(c => c.roleId === role.id).forEach(c => { c.deleted = true; }); this.dirty = true;
    }
    return { ok: true };
  }
  snapshot(windowId) {
    this.advance();
    return { ...structuredClone(this.data), server: this.status(windowId) };
  }
  export() {
    this.advance(); this.mutableId = null;
    const data = { ...structuredClone(this.data), exportedAt: this.clock.wall(), timeZone: this.clock.timeZone() };
    return { ...data, fileName: formatExportFileName(data) };
  }
  reset() {
    this.advance();
    const chatIds = new Set([...this.windows.values()].map(window => window.chatId));
    const chats = this.data.chats.filter(chat => chatIds.has(chat.id));
    const roleIds = new Set(chats.map(chat => chat.roleId).filter(Boolean));
    // Keep only zero-time identities still used by live windows, preserving queue order and import identity.
    this.data = { ...emptyData(this.clock.wall()), roles: this.data.roles.filter(role => roleIds.has(role.id)), chats, segments: [] };
    this.lastMono = this.clock.mono(); this.mutableId = null; this.dirty = true;
    return { ok: true, createdAt: this.data.createdAt };
  }
  import(input) {
    const imported = validateData(input);
    this.advance(); this.mutableId = null;
    this.data.createdAt = imported.segments.reduce((start, segment) => Math.min(start, segment.start), Math.min(this.data.createdAt, imported.createdAt));
    for (const field of ['roles', 'chats', 'segments']) {
      const known = new Set(this.data[field].map(item => item.id));
      this.data[field].push(...imported[field].filter(item => !known.has(item.id)));
    }
    this.dirty = true;
    return { ok: true, segments: this.data.segments.length };
  }
}
