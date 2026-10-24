import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Tracker, emptyData, formatExportFileName } from '../server/tracker.mjs';
import { init, exit } from '../server/index.mjs';
import { exportFileName } from '../frontend/data.mjs';
const total = data => data.segments.reduce((n, segment) => n + segment.end - segment.start, 0);
test('export names use backend time, milliseconds and statistical start date', () => {
  const data = { exportedAt: Date.UTC(2026, 7, 14, 6, 2, 29, 836), createdAt: Date.UTC(2026, 7, 1), timeZone: 'Asia/Shanghai' };
  const name = formatExportFileName(data);
  assert.equal(name, '酒馆时长数据 - 2026-08-14@14h02m29s836ms - 起始2026-08-01.json');
  assert.equal(exportFileName({ ...data, fileName: name }), name);
});
test('reset removes all elapsed time, keeps live queue identity and resets starting date', () => {
  let mono = 0, wall = Date.UTC(2026, 7, 1);
  const tracker = new Tracker(emptyData(wall), { wall: () => wall, mono: () => mono, timeZone: () => 'Asia/Shanghai' });
  tracker.heartbeat({ windowId: 'first', context: { kind: 'solo', avatar: 'A.png', chatName: 'A' } });
  tracker.heartbeat({ windowId: 'second', context: { kind: 'solo', avatar: 'B.png', chatName: 'B' } });
  const chatId = tracker.windows.get('first').chatId;
  mono += 60_000; wall += 60_000; tracker.advance();
  const backup = tracker.export(); assert.equal(total(backup), 60_000);
  wall = Date.UTC(2026, 7, 14, 6); tracker.reset();
  assert.equal(total(tracker.data), 0); assert.equal(tracker.data.createdAt, wall);
  assert.equal(tracker.status('first').state, 'active'); assert.equal(tracker.status('second').state, 'waiting');
  assert.equal(tracker.windows.get('first').chatId, chatId);
  assert.match(tracker.export().fileName, /起始2026-08-14\.json$/);
  mono += 30_000; wall += 30_000; tracker.advance(); assert.equal(total(tracker.data), 30_000);
  tracker.import(backup); assert.equal(tracker.data.roles.length, 2); assert.equal(total(tracker.data), 90_000);
  assert.equal(tracker.data.createdAt, backup.createdAt);
  assert.match(tracker.export().fileName, /起始2026-08-01\.json$/);
});
test('reset API requires confirmation, exports before clearing, and refuses failed backup', async () => {
  const fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-playtime-reset-'));
  const routes = new Map(); await init({ get(route, fn) { routes.set('GET ' + route, fn); }, post(route, fn) { routes.set('POST ' + route, fn); } });
  async function request(root, method, route, body = {}) {
    let payload, status = 200;
    const req = { body, query: {}, user: { profile: { handle: 'synthetic' }, directories: { root } } };
    const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { payload = value; } };
    await routes.get(method + ' ' + route)(req, res); return { status, payload };
  }
  try {
    const root = await fs.mkdtemp(path.join(fixtures, 'reset-'));
    await request(root, 'POST', '/heartbeat', { windowId: 'first', context: { kind: 'lobby' } });
    await new Promise(resolve => setTimeout(resolve, 20));
    const before = (await request(root, 'GET', '/export')).payload; assert(total(before) > 0);
    assert.equal((await request(root, 'POST', '/reset', { exportFirst: true })).status, 400);
    const reset = await request(root, 'POST', '/reset', { confirmed: true, exportFirst: true });
    assert.equal(reset.status, 200); assert(reset.payload.backup); assert(total(reset.payload.backup) >= total(before));
    const file = path.join(root, '.tavern-playtime/backups', reset.payload.backup.fileName);
    const savedBackup = JSON.parse(await fs.readFile(file, 'utf8')); assert.equal(total(savedBackup), total(reset.payload.backup));
    const stored = JSON.parse(await fs.readFile(path.join(root, '.tavern-playtime/tracking.json'), 'utf8'));
    assert.equal(total(stored), 0); assert.equal(stored.createdAt, reset.payload.createdAt);
    await request(root, 'POST', '/release', { windowId: 'first' });
    const unchecked = await request(root, 'POST', '/reset', { confirmed: true, exportFirst: false }); assert.equal(unchecked.status, 200); assert.equal(unchecked.payload.backup, null);
    assert.equal((await fs.readdir(path.join(root, '.tavern-playtime/backups'))).length, 1);
    const blocked = await fs.mkdtemp(path.join(fixtures, 'blocked-'));
    await request(blocked, 'POST', '/heartbeat', { windowId: 'first', context: { kind: 'lobby' } });
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.writeFile(path.join(blocked, '.tavern-playtime/backups'), 'synthetic obstruction');
    const blockedBefore = (await request(blocked, 'GET', '/export')).payload;
    assert.equal((await request(blocked, 'POST', '/reset', { confirmed: true, exportFirst: true })).status, 400);
    const blockedAfter = (await request(blocked, 'GET', '/export')).payload;
    assert(blockedAfter.createdAt === blockedBefore.createdAt); assert(total(blockedAfter) >= total(blockedBefore));
    const failedSave = await fs.mkdtemp(path.join(fixtures, 'failed-save-'));
    await request(failedSave, 'POST', '/heartbeat', { windowId: 'first', context: { kind: 'lobby' } });
    await new Promise(resolve => setTimeout(resolve, 20));
    const saveBefore = (await request(failedSave, 'GET', '/export')).payload;
    const trackingFile = path.join(failedSave, '.tavern-playtime/tracking.json');
    const rename = fs.rename;
    try {
      fs.rename = async (from, to) => { if (to === trackingFile) throw new Error('synthetic save failure'); return rename(from, to); };
      assert.equal((await request(failedSave, 'POST', '/reset', { confirmed: true, exportFirst: false })).status, 400);
      const disk = JSON.parse(await fs.readFile(trackingFile, 'utf8'));
      assert.equal(total(disk), total(saveBefore));
    } finally { fs.rename = rename; }
    const saveAfter = (await request(failedSave, 'GET', '/export')).payload;
    assert.equal(saveAfter.createdAt, saveBefore.createdAt); assert(total(saveAfter) >= total(saveBefore));
  } finally { await exit(); await fs.rm(fixtures, { recursive: true, force: true }); }
});
