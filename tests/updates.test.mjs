import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FRONTEND_VERSION, REQUIRED_BACKEND_VERSION, UPDATE_REMINDER_KEY, backendUpdateState, readUpdateReminderPreference, saveUpdateReminderPreference } from '../frontend/updates.mjs';
import { BACKEND_VERSION, init, exit } from '../server/index.mjs';

test('backend comparisons use numeric release parts and accept newer backends', () => {
  for (const version of ['0.1.9', '0.1.10', '0.1.12']) assert.equal(backendUpdateState(version).kind, 'outdated');
  assert.equal(backendUpdateState(REQUIRED_BACKEND_VERSION).needsUpdate, false);
  assert.equal(backendUpdateState('0.2.0').needsUpdate, false);
  assert.equal(backendUpdateState('1.0.0').needsUpdate, false);
});

test('legacy and invalid backend versions are unknown instead of falsely up to date', () => {
  for (const version of [undefined, null, '', 'latest', '<script>', '0.1', '0.1.13-rc.1', '99999999999999999999.0.0']) {
    const state = backendUpdateState(version); assert.equal(state.kind, 'unknown'); assert.equal(state.needsUpdate, true); assert.equal(state.version, '未提供');
  }
});

test('reminders default on and disabling persists across preference readers', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readUpdateReminderPreference(storage), true);
  saveUpdateReminderPreference(storage, false); assert.equal(values.get(UPDATE_REMINDER_KEY), 'false'); assert.equal(readUpdateReminderPreference(storage), false);
  saveUpdateReminderPreference(storage, true); assert.equal(readUpdateReminderPreference(storage), true);
});

test('unavailable preference storage cannot break the update controls', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(readUpdateReminderPreference(blocked), true); assert.doesNotThrow(() => saveUpdateReminderPreference(blocked, false));
});

test('release metadata, frontend and running backend versions agree', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../frontend/manifest.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(FRONTEND_VERSION, manifest.version); assert.equal(FRONTEND_VERSION, pkg.version); assert.equal(BACKEND_VERSION, REQUIRED_BACKEND_VERSION);
});

test('the API reports running backend version without changing stored or exported records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playtime-version-')), routes = new Map();
  await init({ get(route, fn) { routes.set('GET ' + route, fn); }, post(route, fn) { routes.set('POST ' + route, fn); } });
  async function request(method, route, body = {}) {
    let result, code = 200;
    await routes.get(method + ' ' + route)({body, query: {windowId: 'test'}, user: {profile: {handle: 'test'}, directories: {root}}}, {setHeader() {}, status(value) {code = value; return this;}, json(value) {result = value;}});
    assert.equal(code, 200); return result;
  }
  try {
    const heartbeat = await request('POST', '/heartbeat', {windowId: 'test', context: {kind: 'lobby'}, focused: true});
    assert.equal(heartbeat.backendVersion, BACKEND_VERSION);
    const data = await request('GET', '/data'); assert.equal(data.server.backendVersion, BACKEND_VERSION); assert.equal(data.server.activeWindowId, 'test');
    const exported = await request('GET', '/export'); assert.equal(exported.version, 1); assert(!Object.hasOwn(exported, 'backendVersion')); assert(!Object.hasOwn(exported, 'server'));
    const stored = await fs.readFile(path.join(root, '.tavern-playtime/tracking.json'), 'utf8'); assert(!stored.includes('backendVersion'));
  } finally { await exit(); await fs.rm(root, {recursive: true, force: true}); }
});
