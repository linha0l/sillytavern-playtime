import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Tracker, emptyData } from '../server/tracker.mjs';
import { reconcileLegacyChatRename } from '../server/index.mjs';
const solo = name => ({ kind: 'solo', avatar: 'A.png', roleName: 'A', chatName: name, integrity: 'same-native-integrity' });
async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playtime-compat-'));
  const directory = path.join(root, 'A'); await fs.mkdir(directory);
  let mono = 0;
  const tracker = new Tracker(emptyData(), { mono: () => mono, wall: () => Date.UTC(2026, 9, 23) + mono, timeZone: () => 'UTC' });
  tracker.heartbeat({ windowId: 'window', context: solo('original') });
  const id = tracker.windows.get('window').chatId;
  mono = 60_000; tracker.advance();
  try { await fn({ tracker, id, root, directory }); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('legacy rename preserves the original record and elapsed time after the file moves', () => fixture(async ({ tracker, id, root, directory }) => {
  await fs.writeFile(path.join(directory, 'renamed.jsonl'), 'synthetic');
  await reconcileLegacyChatRename(tracker, solo('renamed'), { chats: root });
  tracker.heartbeat({ windowId: 'window', context: solo('renamed') });
  assert.equal(tracker.data.chats.length, 1); assert.equal(tracker.data.chats[0].id, id);
  assert.equal(tracker.data.chats[0].key, 'renamed'); assert.equal(tracker.data.segments[0].end - tracker.data.segments[0].start, 60_000);
}));
test('an imported chat with copied integrity stays separate while the original file exists', () => fixture(async ({ tracker, id, root, directory }) => {
  for (const name of ['original','imported']) await fs.writeFile(path.join(directory, name + '.jsonl'), 'synthetic');
  await reconcileLegacyChatRename(tracker, solo('imported'), { chats: root });
  tracker.heartbeat({ windowId: 'window', context: solo('imported') });
  assert.equal(tracker.data.chats.length, 2); assert.equal(tracker.data.chats.find(c => c.id === id).key, 'original');
}));
test('ambiguous integrity, missing files and unavailable native paths preserve history', () => fixture(async ({ tracker, id, root, directory }) => {
  await reconcileLegacyChatRename(tracker, solo('missing'), { chats: root }); assert.equal(tracker.data.chats[0].key, 'original');
  await fs.writeFile(path.join(directory, 'new.jsonl'), 'synthetic');
  await reconcileLegacyChatRename(tracker, solo('new'), {}); assert.equal(tracker.data.chats[0].key, 'original');
  tracker.target(solo('imported'), 'window');
  await reconcileLegacyChatRename(tracker, solo('new'), { chats: root }); assert.equal(tracker.data.chats.find(c => c.id === id).key, 'original');
}));
test('legacy matching does not use a different integrity or unsafe path components', () => fixture(async ({ tracker, root, directory }) => {
  await fs.writeFile(path.join(directory, 'new.jsonl'), 'synthetic');
  for (const context of [{ ...solo('new'), integrity: 'different' }, solo('../new'), { ...solo('new'), avatar: '../A.png' }, { ...solo('new'), integrity: '' }]) await reconcileLegacyChatRename(tracker, context, { chats: root });
  assert.equal(tracker.data.chats[0].key, 'original');
}));
