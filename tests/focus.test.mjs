import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracker, emptyData, FOCUS_PAUSE_MS, validateData } from '../server/tracker.mjs';
const MINUTE = 60_000, origin = Date.UTC(2026, 9, 17);
const total = (tracker, chatId) => tracker.data.segments.filter(s => !chatId || s.chatId === chatId).reduce((n, s) => n + s.end - s.start, 0);
function setup(leaseMs) {
  let mono = 0, wall = origin;
  const tracker = new Tracker(emptyData(origin), { mono: () => mono, wall: () => wall, timeZone: () => 'UTC', ...(leaseMs ? { leaseMs } : {}) });
  const beat = (windowId = 'a', focused = false, name = windowId) => tracker.heartbeat({ windowId, focused, context: { kind: 'solo', avatar: windowId + '.png', roleName: windowId, chatName: name } });
  const tick = ms => { mono += ms; wall += ms; };
  return { tracker, beat, tick, shiftWall(ms) { wall += ms; }, minutes(count, states = [['a', false]]) { for (let i = 0; i < count; i++) { tick(MINUTE); for (const [id, focus] of states) beat(id, focus); } } };
}

test('continuous background heartbeats pause exactly at thirty minutes and preserve the blur start', () => {
  const c = setup(); c.beat(); c.minutes(29);
  assert.equal(c.tracker.status('a').state, 'active'); assert.equal(c.tracker.windows.get('a').unfocusedSince, 0);
  c.tick(MINUTE); const paused = c.beat(); assert.equal(paused.state, 'paused'); assert.equal(paused.position, 1);
  assert.equal(total(c.tracker), FOCUS_PAUSE_MS);
  const saved = JSON.stringify(c.tracker.data); c.minutes(20); assert.equal(JSON.stringify(c.tracker.data), saved);
  assert.equal(c.tracker.windows.size, 1);
});

test('an overdue settlement clips the interval at the deadline, not the next heartbeat', () => {
  const c = setup(40 * MINUTE); c.beat(); c.tick(29 * MINUTE + 40_000); c.tracker.advance();
  const before = total(c.tracker); c.tick(MINUTE); c.tracker.advance();
  assert.equal(total(c.tracker) - before, 20_000); assert.equal(total(c.tracker), 30 * MINUTE);
  assert.equal(c.tracker.data.segments.at(-1).end, origin + 30 * MINUTE);
});

test('focus resumes at the receive time and does not fill the paused interval', () => {
  const c = setup(); c.beat(); c.minutes(60); assert.equal(total(c.tracker), 30 * MINUTE);
  assert.equal(c.beat('a', true).state, 'active'); c.tick(MINUTE); c.beat('a', true);
  assert.equal(total(c.tracker), 31 * MINUTE); assert.equal(c.tracker.data.segments.at(-1).start, origin + 60 * MINUTE);
  assert.equal(c.tracker.windows.get('a').unfocusedSince, null);
});

test('focus before the deadline starts a fresh continuous-blur interval on the next blur', () => {
  const c = setup(); c.beat(); c.minutes(20); c.beat('a', true); c.minutes(5, [['a', true]]);
  c.beat('a', false); assert.equal(c.tracker.windows.get('a').unfocusedSince, 25 * MINUTE);
  c.minutes(29); assert.equal(c.tracker.status('a').state, 'active'); c.minutes(1);
  assert.equal(c.tracker.status('a').state, 'paused'); assert.equal(total(c.tracker), 55 * MINUTE);
});

test('paused owner keeps a focused second window waiting until release', () => {
  const c = setup(); c.beat('a'); c.beat('b', true);
  const a = c.tracker.windows.get('a').chatId, b = c.tracker.windows.get('b').chatId;
  c.minutes(40, [['a', false], ['b', true]]);
  assert.equal(c.tracker.status('a').state, 'paused'); assert.equal(c.tracker.status('b').state, 'waiting'); assert.equal(total(c.tracker, b), 0);
  c.tracker.release('a'); assert.equal(c.tracker.status('b').state, 'active'); c.minutes(5, [['b', true]]);
  assert.equal(total(c.tracker, a), 30 * MINUTE); assert.equal(total(c.tracker, b), 5 * MINUTE);
});

test('background successor gets thirty minutes from ownership, not time spent waiting', () => {
  const c = setup(); c.beat('a', true); c.beat('b', false); c.minutes(40, [['a', true], ['b', false]]);
  c.tracker.release('a'); const b = c.tracker.windows.get('b'); assert.equal(b.ownedSince, 40 * MINUTE); assert.equal(b.unfocusedSince, 0);
  assert.equal(c.tracker.status('b').state, 'active'); c.minutes(29, [['b', false]]); assert.equal(c.tracker.status('b').state, 'active');
  c.minutes(1, [['b', false]]); assert.equal(c.tracker.status('b').state, 'paused'); assert.equal(total(c.tracker, b.chatId), 30 * MINUTE);
});

test('lease expiry still hands over from a paused owner and uses the actual expiry as successor start', () => {
  const c = setup(); c.beat('a'); c.beat('b', false); c.minutes(40, [['a', false], ['b', false]]);
  const bId = c.tracker.windows.get('b').chatId; c.minutes(4, [['b', false]]);
  assert.equal(c.tracker.windows.has('a'), false); assert.equal(c.tracker.windows.get('b').ownedSince, 43 * MINUTE);
  assert.equal(total(c.tracker, bId), MINUTE); assert.equal(c.tracker.status('b').state, 'active');
  assert.equal(c.beat('a', true).state, 'waiting');
  c.minutes(29, [['b', false], ['a', true]]); assert.equal(c.tracker.status('b').state, 'paused'); assert.equal(total(c.tracker, bId), 30 * MINUTE);
});

test('refresh is a release and a new queue registration, including a new initial focus state', () => {
  const c = setup(); c.beat(); c.minutes(35); c.tracker.release('a');
  assert.equal(c.beat('a_reload', false).state, 'active'); c.minutes(29, [['a_reload', false]]);
  assert.equal(c.tracker.status('a_reload').state, 'active'); c.minutes(1, [['a_reload', false]]); assert.equal(c.tracker.status('a_reload').state, 'paused');
});

test('chat changes, imports and resets do not reset a continuous blur or resurrect paused time', () => {
  const c = setup(); c.beat(); c.minutes(15); c.beat('a', false, 'changed'); c.minutes(20);
  assert.equal(c.tracker.status('a').state, 'paused'); const exported = c.tracker.export();
  c.tracker.import(exported); c.tracker.reset(); assert.equal(c.tracker.status('a').state, 'paused'); assert.equal(total(c.tracker), 0);
  c.minutes(2); assert.equal(total(c.tracker), 0); c.beat('a', true); c.minutes(1, [['a', true]]); assert.equal(total(c.tracker), MINUTE);
});

test('focus state remains ephemeral and missing focus data from old pages is compatible', () => {
  const c = setup(); c.tracker.heartbeat({ windowId: 'legacy', context: { kind: 'lobby' } });
  assert.equal(c.tracker.windows.get('legacy').focused, true); c.tracker.release('legacy'); c.beat(); c.minutes(31);
  c.tracker.heartbeat({ windowId: 'a', context: { kind: 'lobby' } }); assert.equal(c.tracker.status('a').state, 'paused');
  const exported = c.tracker.export(); assert.deepEqual(Object.keys(c.tracker.data), ['schema', 'version', 'createdAt', 'roles', 'chats', 'segments']);
  assert(!JSON.stringify(exported).includes('unfocusedSince')); assert(!JSON.stringify(exported).includes('ownedSince'));
  validateData(exported); const restored = new Tracker(exported); assert.equal(restored.windows.size, 0); assert.equal(total(restored), 30 * MINUTE);
});

test('system clock shifts do not change the thirty-minute focus grace', () => {
  const c = setup(); c.beat(); c.minutes(15); c.shiftWall(8 * 3600_000); c.minutes(15);
  assert.equal(c.tracker.status('a').state, 'paused'); assert.equal(total(c.tracker), 30 * MINUTE);
});
