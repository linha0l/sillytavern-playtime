import test from 'node:test';
import assert from 'node:assert/strict';
import { describeContext, createContextReader } from '../frontend/index.js';
import { reportData } from '../frontend/data.mjs';
const message = type => {
  const value = { extra: { type } };
  Object.defineProperty(value, 'mes', { get() { throw new Error('Classification must not read message text'); } });
  return value;
};
test('an initialized welcome screen with messages is lobby, not temporary', () => {
  const context = { characters: [], chat: [message('welcome'), message('assistant_message'), message('welcome_prompt')] };
  assert.deepEqual(describeContext(context, 'window'), { kind: 'lobby' });
  assert.deepEqual(describeContext({ characters: [], chat: [] }, 'window'), { kind: 'lobby' });
});
test('only the native assistant_note identifies unsaved temporary-chat mode', () => {
  assert.equal(describeContext({ characters: [], chat: [message('assistant_note')] }, 'window').kind, 'temporary');
  assert.equal(describeContext({ characters: [], chat: [message('assistant_message')] }, 'window').kind, 'lobby');
});
test('selected character and group contexts take priority over message markers', () => {
  const context = { characterId: 0, characters: [{ avatar: 'A.png', name: 'A' }], chatId: 'main', chat: [message('assistant_note')], chatMetadata: { integrity: 'native' } };
  assert.equal(describeContext(context, 'window').kind, 'solo');
  assert.equal(describeContext({ ...context, groupId: 'group', groups: [{ id: 'group', name: '群聊' }] }, 'window').kind, 'group');
});
test('a temporary session remains stable while chatting, and a new native note starts another', () => {
  const read = createContextReader('window');
  const first = { characters: [], chat: [message('assistant_note')] };
  const one = read(first).sessionId;
  first.chat.push(message('ordinary')); assert.equal(read(first).sessionId, one);
  assert.equal(read({ characters: [], chat: [message('welcome_prompt')] }).kind, 'lobby');
  assert.notEqual(read({ characters: [], chat: [message('assistant_note')] }).sessionId, one);
});
test('other list contains only temporary chats while total still includes lobby and group', () => {
  const snapshot = { roles: [], chats: [
    { id: 'lobby', roleId: null, kind: 'lobby', name: '主界面' },
    { id: 'temp', roleId: null, kind: 'temporary', name: '临时聊天' },
    { id: 'group', roleId: null, kind: 'group', name: '群聊' }
  ], segments: ['lobby','temp','group'].map((chatId, i) => ({ id: chatId, chatId, start: Date.UTC(2026, 9, 9) + i * 60_000, end: Date.UTC(2026, 9, 9) + (i + 1) * 60_000 })), server: { now: Date.UTC(2026, 9, 9, 3), timeZone: 'UTC' } };
  const result = reportData(snapshot), other = result.catalog.find(role => role.id === 'other');
  assert.deepEqual(other.chats.map(chat => chat.id), ['temp']);
  assert.equal(other.total, 3); assert.equal(other.chats[0].total, 1);
  assert.equal(result.records.reduce((n, record) => n + record.minutes, 0), 3);
});
