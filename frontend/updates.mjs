export const FRONTEND_VERSION = '0.1.14';
export const REQUIRED_BACKEND_VERSION = '0.1.13';
export const UPDATE_COMMAND = 'git -C plugins/sillytavern-playtime pull --ff-only';
export const UPDATE_NOTES_URL = 'https://github.com/linha0l/sillytavern-playtime/blob/main/CHANGELOG.md';
export const UPDATE_REMINDER_KEY = 'tavern-playtime-backend-update-reminders';
export const UPDATE_REMINDER_RISK = '关闭后，后端版本落后时将不再提醒。前后端版本不兼容可能导致部分功能异常。';

function parts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) return null;
  const result = value.split('.').map(Number);
  return result.every(Number.isSafeInteger) ? result : null;
}

export function backendUpdateState(version) {
  const actual = parts(version), required = parts(REQUIRED_BACKEND_VERSION);
  if (!actual) return { kind: 'unknown', needsUpdate: true, version: '未提供', label: '后端版本待确认', message: '后端未提供版本信息，请更新后端并重启酒馆。' };
  const first = actual.findIndex((part, index) => part !== required[index]);
  const needsUpdate = first !== -1 && actual[first] < required[first];
  return { kind: needsUpdate ? 'outdated' : 'compatible', needsUpdate, version, label: needsUpdate ? '后端有更新' : '', message: needsUpdate ? '更新后端并重启酒馆后生效。' : '已满足当前前端的版本要求。' };
}

export function readUpdateReminderPreference(storage) {
  try { return storage.getItem(UPDATE_REMINDER_KEY) !== 'false'; } catch { return true; }
}

export function saveUpdateReminderPreference(storage, enabled) {
  try { storage.setItem(UPDATE_REMINDER_KEY, String(enabled)); } catch { /* The toggle still applies to the current panel. */ }
}
