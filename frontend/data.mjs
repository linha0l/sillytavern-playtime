const DAY = 86_400_000;
export function localDate(time, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const get = name => parts.find(part => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function exportFileName(data) {
  if (typeof data.fileName !== 'string' || !data.fileName.endsWith('.json') || /[/\\]/.test(data.fileName)) throw new Error('服务端未提供导出文件名，请先更新服务端插件。');
  return data.fileName;
}
export function reportData(snapshot) {
  const zone = snapshot.server.timeZone;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const date = time => { const parts = formatter.formatToParts(time); return ['year', 'month', 'day'].map(name => parts.find(p => p.type === name).value).join('-'); };
  const chats = new Map(snapshot.chats.map(chat => [chat.id, chat]));
  const aggregated = new Map(), roleTotals = new Map(), chatTotals = new Map();
  for (const segment of snapshot.segments) {
    const chat = chats.get(segment.chatId);
    if (!chat) continue;
    const role = chat.roleId || 'other';
    let cursor = segment.start;
    while (cursor < segment.end) {
      const day = date(cursor);
      let end = segment.end;
      if (date(end - 1) !== day) {
        let low = cursor, high = end;
        while (high - low > 1) { const middle = Math.floor((low + high) / 2); if (date(middle) === day) low = middle; else high = middle; }
        end = high;
      }
      const key = `${day}:${role}:${chat.id}`;
      const row = aggregated.get(key) || { date: day, role, chat: chat.id, minutes: 0 };
      const minutes = (end - cursor) / 60_000;
      row.minutes += minutes; aggregated.set(key, row);
      roleTotals.set(role, (roleTotals.get(role) || 0) + minutes);
      chatTotals.set(chat.id, (chatTotals.get(chat.id) || 0) + minutes);
      cursor = end;
    }
  }
  const catalog = snapshot.roles.map(role => ({ id: role.id, name: role.name + (role.deleted ? '（历史）' : ''), total: roleTotals.get(role.id) || 0,
    chats: snapshot.chats.filter(chat => chat.roleId === role.id).map(chat => ({ id: chat.id, name: chat.name + (chat.deleted ? '（历史）' : ''), total: chatTotals.get(chat.id) || 0 })) }));
  const otherChats = snapshot.chats.filter(chat => !chat.roleId && chat.kind === 'temporary').map(chat => ({ id: chat.id, name: chat.name, total: chatTotals.get(chat.id) || 0 }));
  catalog.push({ id: 'other', name: '未归属时长', total: roleTotals.get('other') || 0, chats: otherChats });
  return { catalog, records: [...aggregated.values()], today: Date.parse(localDate(snapshot.server.now, zone) + 'T00:00:00Z'), timeZone: zone };
}
export { DAY };
