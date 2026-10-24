import fs from 'node:fs/promises';
import path from 'node:path';
import { Tracker, emptyData } from './tracker.mjs';

// This is the running module's version, not a package file that git pull may replace.
export const BACKEND_VERSION = '0.1.13';
export const info = { id: 'tavern-playtime', name: '酒馆时长', description: '按窗口队列统计角色与聊天时长。', version: BACKEND_VERSION };
const stores = new Map();
const loading = new Map();
let timer;
export async function reconcileLegacyChatRename(tracker, context, directories) {
  // ST 1.14–1.17 reloads renamed chats without emitting CHAT_RENAMED.
  // Integrity alone is not unique: imports can copy it. Confirm the old file
  // disappeared and the new file exists, without reading either chat's contents.
  if (context?.kind !== 'solo' || !context.integrity || !directories?.chats) return;
  const role = tracker.data.roles.find(r => !r.deleted && r.avatar === context.avatar);
  if (!role) return;
  const key = String(context.chatName || '').replace(/\.jsonl$/i, '');
  if (tracker.data.chats.some(c => !c.deleted && c.roleId === role.id && c.key === key)) return;
  const candidates = tracker.data.chats.filter(c => !c.deleted && c.kind === 'solo' && c.roleId === role.id && c.integrity === context.integrity);
  if (candidates.length !== 1) return;
  const previous = candidates[0], avatarDirectory = String(context.avatar).replace(/\.png$/, '');
  if ([avatarDirectory, previous.key, key].some(name => !name || name === '.' || name === '..' || /[/\\\x00:]/.test(name) || name.length > 300)) return;
  const directory = path.join(directories.chats, avatarDirectory);
  try {
    const exists = async name => { try { return (await fs.stat(path.join(directory, name + '.jsonl'))).isFile(); } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
    if (!await exists(previous.key) && await exists(key)) tracker.lifecycle({ kind: 'chat-rename', avatar: context.avatar, oldName: previous.key, newName: key });
  } catch { /* Uncertain identity keeps the old record and creates a separate one. */ }
}
export async function init(router) {
  async function store(req) {
    if (!req.user?.profile?.handle || !req.user?.directories?.root) throw new Error('请先登录酒馆。');
    const key = path.resolve(req.user.directories.root);
    if (loading.has(key)) return loading.get(key);
    if (!stores.has(key)) {
      const pending = (async () => {
        const directory = path.join(key, '.tavern-playtime'), file = path.join(directory, 'tracking.json');
        let data;
        try { data = JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (e) { if (e.code !== 'ENOENT') throw new Error('统计文件读取失败，原文件已保留。'); data = emptyData(); }
        stores.set(key, { tracker: new Tracker(data), directory, file, queue: Promise.resolve() });
        return stores.get(key);
      })();
      loading.set(key, pending);
      try { return await pending; } finally { loading.delete(key); }
    }
    return stores.get(key);
  }
  async function flush(s) {
    if (!s.tracker.dirty) return;
    await fs.mkdir(s.directory, { recursive: true });
    const temporary = s.file + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(s.tracker.data), 'utf8');
    await fs.rename(temporary, s.file);
    s.tracker.dirty = false;
  }
  function handler(action, save = false) {
    return async (req, res) => {
      try {
        const s = await store(req);
        const operation = s.queue.catch(() => {}).then(async () => {
          const result = await action(s.tracker, req, s);
          if (save) await flush(s);
          res.setHeader('Cache-Control', 'no-store'); res.json(result);
        });
        s.queue = operation; await operation;
      } catch (e) { res.status(400).json({ error: String(e.message || e).slice(0, 300) }); }
    };
  }
  router.post('/heartbeat', handler(async (t, req) => {
    if (req.body.legacyChatRename === true) await reconcileLegacyChatRename(t, req.body.context, req.user?.directories);
    return { ...t.heartbeat(req.body), backendVersion: BACKEND_VERSION };
  }, true));
  router.post('/release', handler((t, req) => t.release(req.body.windowId), true));
  router.post('/lifecycle', handler((t, req) => t.lifecycle(req.body), true));
  router.get('/data', handler((t, req) => { const data = t.snapshot(req.query.windowId); return { ...data, server: { ...data.server, backendVersion: BACKEND_VERSION } }; }));
  router.get('/export', handler(t => t.export(), true));
  router.post('/import', handler((t, req) => t.import(req.body), true));
  router.post('/reset', handler(async (t, req, s) => {
    if (req.body.confirmed !== true) throw new Error('请先确认清除全部时长数据。');
    const before = t.export();
    if (req.body.exportFirst === true) {
      const backupDirectory = path.join(s.directory, 'backups'); await fs.mkdir(backupDirectory, { recursive: true });
      const backupFile = path.join(backupDirectory, before.fileName);
      await fs.writeFile(backupFile, JSON.stringify(before, null, 2), { encoding: 'utf8', flag: 'wx' });
    }
    const previous = { data: { schema: before.schema, version: before.version, createdAt: before.createdAt, roles: before.roles, chats: before.chats, segments: before.segments }, lastMono: t.lastMono, mutableId: t.mutableId };
    try {
      const result = t.reset(); await flush(s);
      return { ...result, backup: req.body.exportFirst === true ? before : null };
    } catch (error) {
      t.data = previous.data; t.lastMono = previous.lastMono; t.mutableId = previous.mutableId; t.dirty = true;
      throw error;
    }
  }));
  timer = setInterval(() => {
    for (const s of stores.values()) s.queue = s.queue.catch(() => {}).then(async () => { s.tracker.advance(); await flush(s); }).catch(() => { console.error('[tavern-playtime] 统计保存失败，等待下次重试。'); });
  }, 60_000);
  timer.unref?.();
}
export async function exit() {
  clearInterval(timer);
  for (const s of stores.values()) {
    await s.queue.catch(() => {}); s.tracker.advance();
    if (s.tracker.dirty) {
      await fs.mkdir(s.directory, { recursive: true });
      await fs.writeFile(s.file + '.tmp', JSON.stringify(s.tracker.data), 'utf8');
      await fs.rename(s.file + '.tmp', s.file);
    }
  }
  stores.clear();
}
