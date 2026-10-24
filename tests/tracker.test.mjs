import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, emptyData, validateData } from '../server/tracker.mjs';
import { reportData } from '../frontend/data.mjs';
const solo = (name, avatar = 'A.png', integrity = name) => ({ kind: 'solo', avatar, roleName: avatar.replace('.png', ''), chatName: name, integrity });
function clock() {
  let mono = 0, wall = Date.UTC(2026, 9, 9), zone = 'UTC';
  const tracker = new Tracker(emptyData(), { mono: () => mono, wall: () => wall, timeZone: () => zone });
  return { tracker, advance(ms) { mono += ms; wall += ms; }, shiftWall(ms) { wall += ms; }, zone(value) { zone = value; } };
}
const duration = t => t.data.segments.reduce((n, s) => n + s.end - s.start, 0);
const chatDuration = (t, id) => t.data.segments.filter(s => s.chatId === id).reduce((n, s) => n + s.end - s.start, 0);

test('the agreed A/B example produces A 20 min, B 10 min, total 30 min', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window1', context: solo('A') });
  t.heartbeat({ windowId: 'window2', context: solo('B', 'B.png') });
  const A = t.windows.get('window1').chatId, B = t.windows.get('window2').chatId;
  for (let i = 0; i < 20; i++) { c.advance(60_000); t.heartbeat({ windowId: 'window1', context: solo('A') }); t.heartbeat({ windowId: 'window2', context: solo('B', 'B.png') }); }
  t.release('window1');
  assert.equal(t.status('window2').state, 'active');
  for (let i = 0; i < 10; i++) { c.advance(60_000); t.heartbeat({ windowId: 'window2', context: solo('B', 'B.png') }); }
  t.release('window2');
  assert.equal(chatDuration(t, A), 20 * 60_000); assert.equal(chatDuration(t, B), 10 * 60_000); assert.equal(duration(t), 30 * 60_000);
});
test('switching chats settles the previous target, without inheriting checkpoint time', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('main') }); const main = t.windows.get('window').chatId;
  c.advance(60_000); t.heartbeat({ windowId: 'window', context: solo('checkpoint') }); const checkpoint = t.windows.get('window').chatId;
  assert.equal(chatDuration(t, main), 60_000); assert.equal(chatDuration(t, checkpoint), 0);
  c.advance(60_000); t.release('window'); assert.equal(chatDuration(t, checkpoint), 60_000); assert.equal(t.data.roles.length, 1);
});
test('expiry hands over once and old windows rejoin at the tail', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'first', context: solo('A') }); t.heartbeat({ windowId: 'second', context: solo('B') });
  c.advance(100_000); t.heartbeat({ windowId: 'second', context: solo('B') });
  c.advance(81_000); t.advance();
  assert.equal(t.status('second').state, 'active'); assert.equal(duration(t), 181_000);
  const status = t.heartbeat({ windowId: 'first', context: solo('A') }); assert.equal(status.state, 'waiting');
  t.release('second'); t.release('first'); c.advance(300_000); t.advance(); assert.equal(duration(t), 181_000);
});
test('native reload-before-rename keeps one chat and all elapsed time', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('old', 'A.png', 'same') }); const old = t.windows.get('window').chatId;
  c.advance(10_000); t.heartbeat({ windowId: 'window', context: solo('new', 'A.png', 'same') });
  c.advance(1_000); t.lifecycle({ kind: 'chat-rename', avatar: 'A.png', oldName: 'old.jsonl', newName: 'new.jsonl' });
  assert.equal(t.data.chats.length, 1); assert.equal(t.data.chats[0].id, old); assert.equal(t.data.chats[0].name, 'new'); assert.equal(duration(t), 11_000); assert.equal(t.windows.get('window').chatId, old);
});
test('role rename preserves history; copied cards and imported filenames are separate', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('main', 'A.png', 'copied-integrity') }); const role = t.data.roles[0].id;
  c.advance(60_000); t.lifecycle({ kind: 'role-rename', oldAvatar: 'A.png', newAvatar: 'renamed.png' });
  t.heartbeat({ windowId: 'window', context: solo('main', 'renamed.png', 'copied-integrity') }); assert.equal(t.data.roles.length, 1); assert.equal(t.data.roles[0].id, role);
  t.heartbeat({ windowId: 'window', context: solo('main imported', 'renamed.png', 'copied-integrity') }); assert.equal(t.data.chats.length, 2);
  t.heartbeat({ windowId: 'window', context: solo('main', 'copy.png', 'copied-integrity') }); assert.equal(t.data.roles.length, 2); assert.equal(t.data.chats.length, 3);
});
test('overwrites with a new integrity preserve old history separately', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('same', 'A.png', 'before') }); c.advance(30_000);
  t.heartbeat({ windowId: 'window', context: solo('same', 'A.png', 'after') });
  assert.equal(t.data.chats.length, 2); assert.equal(t.data.chats[0].deleted, true); assert.equal(duration(t), 30_000);
});
test('a new card reusing an old renamed filename does not inherit the old role', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('main', 'A.png', 'before') }); const original = t.data.roles[0].id;
  c.advance(60_000); t.lifecycle({ kind: 'role-rename', oldAvatar: 'A.png', newAvatar: 'renamed.png' });
  t.heartbeat({ windowId: 'window', context: solo('main', 'A.png', 'new-card') });
  assert.equal(t.data.roles.length, 2); assert.notEqual(t.data.chats.find(chat => chat.id === t.windows.get('window').chatId).roleId, original);
  assert.equal(t.data.roles.find(role => role.id === original).avatar, 'renamed.png');
});
test('lobby, temporary chats and groups remain other time', () => {
  const c = clock(), t = c.tracker;
  for (const context of [{ kind: 'lobby' }, { kind: 'temporary', sessionId: 'temporary' }, { kind: 'group', groupId: 'group', chatName: 'groupchat' }]) {
    t.heartbeat({ windowId: 'window', context }); c.advance(10_000);
  }
  t.release('window'); assert.equal(t.data.roles.length, 0); assert.equal(t.data.chats.length, 3); assert.equal(duration(t), 30_000);
});
test('repeated data imports are idempotent and runtime queues are not imported', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('main') }); c.advance(30_000); const data = t.export();
  const restored = new Tracker(emptyData()); restored.import(data); restored.import(data);
  assert.equal(duration(restored), 30_000); assert.equal(restored.windows.size, 0);
  assert.throws(() => restored.import({ ...data, segments: [...data.segments, ...data.segments] })); assert.equal(duration(restored), 30_000);
});
test('a restarted tracker preserves totals without counting the downtime', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('main') }); c.advance(60_000); const data = t.export();
  c.advance(3600_000); const restored = new Tracker(data); restored.advance(); assert.equal(duration(restored), 60_000);
});
test('system clock adjustment changes timestamps but not measured duration', () => {
  const c = clock(), t = c.tracker;
  t.heartbeat({ windowId: 'window', context: solo('main') }); c.advance(60_000); t.advance(); c.shiftWall(-8 * 3600_000); c.zone('Asia/Shanghai');
  c.advance(60_000); t.advance(); assert.equal(duration(t), 120_000); assert.equal(t.snapshot('window').server.timeZone, 'Asia/Shanghai'); validateData(t.export());
});
test('midnight splitting follows server timezone; changing zones does not change totals', () => {
  const c = clock(), t = c.tracker; t.heartbeat({ windowId: 'window', context: solo('main') }); const chatId = t.windows.get('window').chatId;
  t.data.segments = [{ id: 'segment', chatId, start: Date.UTC(2026, 9, 8, 15, 30), end: Date.UTC(2026, 9, 8, 17, 30) }];
  const snapshot = t.snapshot('window'); snapshot.server.timeZone = 'UTC'; const utc = reportData(snapshot);
  snapshot.server.timeZone = 'Asia/Shanghai'; const shanghai = reportData(snapshot);
  assert.deepEqual(utc.records.map(r => [r.date, r.minutes]), [['2026-10-08', 120]]);
  assert.deepEqual(shanghai.records.map(r => [r.date, r.minutes]), [['2026-10-08', 30], ['2026-10-09', 90]]);
  assert.equal(utc.records.reduce((n, r) => n + r.minutes, 0), shanghai.records.reduce((n, r) => n + r.minutes, 0));
});
