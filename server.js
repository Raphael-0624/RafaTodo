import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import * as entryUtils from './src/lib/entries.js';
import {batchMoveEntries,pastedLines} from './src/lib/interactions.js';

const {domains, moveEntries, nextPosition, loopPeriodKey} = entryUtils;
const normalizeEntryLayout = typeof entryUtils.normalizeEntryLayout === 'function' ? entryUtils.normalizeEntryLayout : items => items;
const compactEntryPositions = typeof entryUtils.compactEntryPositions === 'function' ? entryUtils.compactEntryPositions : items => items;
const dataDir = process.env.DATA_DIR || './data';
const uploadDir = path.join(dataDir, 'uploads');
mkdirSync(uploadDir, {recursive: true});

const db = new DatabaseSync(path.join(dataDir, 'rafa.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS daily_items (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS daily_completions (
    item_id TEXT NOT NULL,
    date TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (item_id, date)
  );
  CREATE INDEX IF NOT EXISTS daily_items_position_idx ON daily_items(position);
  CREATE TABLE IF NOT EXISTS activity_daily (
    date TEXT NOT NULL,
    domain TEXT NOT NULL,
    created_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    removed_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, domain)
  );
  CREATE TABLE IF NOT EXISTS loop_completions (
    entry_id TEXT NOT NULL,
    loop_kind TEXT NOT NULL,
    period_key TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (entry_id, loop_kind, period_key)
  );
  CREATE INDEX IF NOT EXISTS loop_completions_entry_idx ON loop_completions(entry_id);
  CREATE INDEX IF NOT EXISTS entries_archived_at_idx ON entries(json_extract(data, '$.archivedAt'));
  CREATE INDEX IF NOT EXISTS entries_domain_idx ON entries(json_extract(data, '$.domain'));
  CREATE INDEX IF NOT EXISTS entries_pinned_at_idx ON entries(json_extract(data, '$.pinnedAt'));
  CREATE INDEX IF NOT EXISTS entries_parent_id_idx ON entries(json_extract(data, '$.parentId'));
  CREATE TABLE IF NOT EXISTS entry_links (owner_id TEXT NOT NULL, target_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (owner_id, target_id, kind));
  CREATE INDEX IF NOT EXISTS entry_links_target_idx ON entry_links(target_id);
  CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
  CREATE TRIGGER IF NOT EXISTS entries_links_ai AFTER INSERT ON entries BEGIN
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT new.id, value, 'parent' FROM json_each(new.data, '$.parentId') WHERE value IS NOT NULL AND value <> '';
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT new.id, value, 'dependency' FROM json_each(new.data, '$.dependencies') WHERE value IS NOT NULL AND value <> '';
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT new.id, value, 'related' FROM json_each(new.data, '$.related') WHERE value IS NOT NULL AND value <> '';
  END;
  CREATE TRIGGER IF NOT EXISTS entries_links_au AFTER UPDATE OF data ON entries BEGIN
    DELETE FROM entry_links WHERE owner_id = old.id;
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT new.id, value, 'parent' FROM json_each(new.data, '$.parentId') WHERE value IS NOT NULL AND value <> '';
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT new.id, value, 'dependency' FROM json_each(new.data, '$.dependencies') WHERE value IS NOT NULL AND value <> '';
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT new.id, value, 'related' FROM json_each(new.data, '$.related') WHERE value IS NOT NULL AND value <> '';
  END;
  CREATE TRIGGER IF NOT EXISTS entries_links_ad AFTER DELETE ON entries BEGIN DELETE FROM entry_links WHERE owner_id = old.id; END;
`);
if(db.prepare('SELECT 1 FROM entry_links LIMIT 1').get()===undefined){
  db.exec(`
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT id, json_extract(data, '$.parentId'), 'parent' FROM entries WHERE json_extract(data, '$.parentId') IS NOT NULL AND json_extract(data, '$.parentId') <> '';
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT entries.id, json_each.value, 'dependency' FROM entries, json_each(entries.data, '$.dependencies') WHERE json_each.value IS NOT NULL AND json_each.value <> '';
    INSERT OR IGNORE INTO entry_links(owner_id, target_id, kind) SELECT entries.id, json_each.value, 'related' FROM entries, json_each(entries.data, '$.related') WHERE json_each.value IS NOT NULL AND json_each.value <> '';
  `);
}

function transaction(run) {
  db.exec('BEGIN');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readEntries() {
  return hydrateLoopEntries(db.prepare('SELECT data FROM entries').all().map(row => JSON.parse(row.data)));
}

function unarchivedEntries() {
  return hydrateLoopEntries(db.prepare("SELECT data FROM entries WHERE json_extract(data, '$.archivedAt') IS NULL").all()
    .map(row => JSON.parse(row.data)))
    .filter(item => !item.archivedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function archivedEntries() {
  return hydrateLoopEntries(db.prepare("SELECT data FROM entries WHERE json_extract(data, '$.archivedAt') > ''").all()
    .map(row => JSON.parse(row.data)))
    .filter(item => item.archivedAt)
    .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
}

function withoutPosition(item) {
  const {position, ...rest} = item;
  return JSON.stringify(rest);
}

function positionOnlyChange(before, after) {
  return withoutPosition(before) === withoutPosition(after);
}

function persistChangedEntries(beforeItems, afterItems, {touch = () => false, onChanged = () => {}} = {}) {
  const beforeById = new Map(beforeItems.map(item => [item.id, item]));
  const now = new Date().toISOString();
  const changed = [];
  for (const item of afterItems) {
    const before = beforeById.get(item.id);
    if (!before || JSON.stringify(before) === JSON.stringify(item)) continue;
    if (touch(item, before)) item.updatedAt = now;
    db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item), item.id);
    changed.push(item);
    onChanged(item, before);
  }
  return changed;
}

function compactStoredEntries() {
  const before = readEntries();
  const after = compactEntryPositions(before);
  persistChangedEntries(before, after);
  return after;
}

function rowsForDomainAndDescendants(domain) {
  const rows = new Map();
  const pending = db.prepare("SELECT id, data FROM entries WHERE json_extract(data, '$.domain')=?").all(domain);
  for (const row of pending) rows.set(row.id, JSON.parse(row.data));
  let frontier = pending.map(row => row.id);
  while (frontier.length) {
    const next = [];
    for (let offset = 0; offset < frontier.length; offset += 400) {
      const ids = frontier.slice(offset, offset + 400);
      const placeholders = ids.map(() => '?').join(',');
      const children = db.prepare(`SELECT id, data FROM entries WHERE json_extract(data, '$.parentId') IN (${placeholders})`).all(...ids);
      for (const row of children) {
        if (rows.has(row.id)) continue;
        rows.set(row.id, JSON.parse(row.data));
        next.push(row.id);
      }
    }
    frontier = next;
  }
  return [...rows.values()];
}

const LOOP_TIME_ZONE = process.env.LOOP_TIME_ZONE || process.env.DAILY_TIME_ZONE || 'Asia/Shanghai';

function loopKey(item, now = new Date()) {
  return loopPeriodKey(item.loop, now, LOOP_TIME_ZONE);
}

// Completion history is keyed by the immutable entry UUID, never by a title.
// A title edit, reorder or move therefore cannot disturb the counter.
function loopRecordFor(item, period = loopKey(item), records) {
  if (item.type !== 'todo' || !['day', 'week'].includes(item.loop)) return null;
  if (records) return records.periods.get(period) || null;
  return db.prepare('SELECT completed_at AS completedAt FROM loop_completions WHERE entry_id=? AND loop_kind=? AND period_key=?')
    .get(item.id, item.loop, period) || null;
}

function loopCompletedCount(item) {
  if (item.type !== 'todo' || !['day', 'week'].includes(item.loop)) return 0;
  return Number(db.prepare('SELECT COUNT(*) AS count FROM loop_completions WHERE entry_id=?').get(item.id)?.count) || 0;
}

function hydrateLoopEntry(item, now = new Date(), records) {
  if (item.type !== 'todo' || !['day', 'week'].includes(item.loop)) {
    item.loop = '';
    item.loopPeriod = '';
    delete item.loopCompletedCount;
    delete item.loopCompletionKey;
    return item;
  }
  item.loopPeriod = loopKey(item, now);
  item.loopCompletedCount = records ? records.total : loopCompletedCount(item);
  const record = loopRecordFor(item, item.loopPeriod, records);
  if (record && item.status !== 'removed') {
    item.status = 'done';
    item.completedAt = record.completedAt;
  } else if (!record && item.status === 'done' && !item.archivedAt) {
    // A completed loop task without a completion for this period is a task
    // that has crossed into a new period. It must start open again.
    item.status = 'open';
    item.completedAt = null;
  }
  delete item.loopCompletionKey;
  return item;
}

function hydrateLoopEntries(items, now = new Date()) {
  const ids = [...new Set(items.filter(item => item.type === 'todo' && ['day', 'week'].includes(item.loop)).map(item => item.id))];
  const byId = new Map(items.map(item => [item.id, item]));
  const records = new Map();
  for (let offset = 0; offset < ids.length; offset += 400) {
    const chunk = ids.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`SELECT entry_id AS entryId,period_key AS periodKey,completed_at AS completedAt FROM loop_completions WHERE entry_id IN (${placeholders})`).all(...chunk);
    for (const row of rows) {
      if (!records.has(row.entryId)) records.set(row.entryId, {total: 0, periods: new Map()});
      const record = records.get(row.entryId);
      record.total++;
      record.periods.set(row.periodKey, row);
    }
  }
  for (const item of items) hydrateLoopEntry(item, now, records.get(item.id) || {total: 0, periods: new Map()});
  return items;
}

function setLoopCompletion(item, completed, now = new Date()) {
  if (item.type !== 'todo' || !['day', 'week'].includes(item.loop)) return;
  const period = loopKey(item, now);
  if (completed) {
    db.prepare('INSERT OR IGNORE INTO loop_completions (entry_id,loop_kind,period_key,completed_at) VALUES (?,?,?,?)')
      .run(item.id, item.loop, period, now.toISOString());
  } else {
    db.prepare('DELETE FROM loop_completions WHERE entry_id=? AND loop_kind=? AND period_key=?')
      .run(item.id, item.loop, period);
  }
}

function startupMigration() {
  const rows = db.prepare('SELECT id, data FROM entries').all();
  const original = new Map();
  const migrated = rows.map(row => {
    const item = JSON.parse(row.data);
    original.set(item.id, row.data);
    if (item.domain === 'Glean' || item.domain === 'Idea') item.domain = 'Glean & Idea';
    return item;
  });
  let normalized = migrated;
  try {
    normalized = normalizeEntryLayout(migrated);
  } catch (error) {
    console.error('[startup] 布局归一化失败，已跳过:', error.message);
  }
  if (!Array.isArray(normalized)) return;
  const changes = normalized.filter(item => original.get(item.id) !== JSON.stringify(item));
  if (!changes.length) return;
  transaction(() => {
    for (const item of changes) db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item), item.id);
  });
  console.log(`[startup] 已归一化 ${changes.length} 条数据布局`);
}

startupMigration();

// Earlier builds stored loop counters inside the entry JSON. Import those
// records once into the ID-scoped ledger, then remove the duplicated fields.
function migrateLoopLedger() {
  if (db.prepare("SELECT 1 FROM settings WHERE key='loop-ledger-v1'").get()) return;
  const rows = db.prepare("SELECT id,data FROM entries WHERE json_extract(data, '$.type')='todo' AND json_extract(data, '$.loop') IN ('day','week')").all();
  let imported = 0;
  transaction(() => {
    for (const row of rows) {
      const item = JSON.parse(row.data);
      const loop = item.loop;
      const count = Math.max(0, Number(item.loopCompletedCount) || 0);
      const period = typeof item.loopPeriod === 'string' ? item.loopPeriod : '';
      const completionKey = typeof item.loopCompletionKey === 'string' ? item.loopCompletionKey : '';
      const completed = item.status === 'done';
      const currentPeriod = loopPeriodKey(loop, new Date(), LOOP_TIME_ZONE);
      if (completed && period && completionKey === period) {
        db.prepare('INSERT OR IGNORE INTO loop_completions (entry_id,loop_kind,period_key,completed_at) VALUES (?,?,?,?)')
          .run(item.id, loop, period, item.completedAt || item.updatedAt || item.createdAt || new Date().toISOString());
        imported++;
      } else if (completed && !period) {
        db.prepare('INSERT OR IGNORE INTO loop_completions (entry_id,loop_kind,period_key,completed_at) VALUES (?,?,?,?)')
          .run(item.id, loop, currentPeriod, item.completedAt || item.updatedAt || item.createdAt || new Date().toISOString());
        imported++;
      }
      const known = Number(db.prepare('SELECT COUNT(*) AS count FROM loop_completions WHERE entry_id=? AND loop_kind=?').get(item.id, loop)?.count) || 0;
      // If the old JSON had a positive total but no usable period, keep the
      // total as historical records so a user's counter does not drop to zero.
      for (let index = known; index < count; index++) {
        db.prepare('INSERT OR IGNORE INTO loop_completions (entry_id,loop_kind,period_key,completed_at) VALUES (?,?,?,?)')
          .run(item.id, loop, 'legacy-' + index, item.updatedAt || item.createdAt || new Date().toISOString());
      }
      delete item.loopCompletedCount;
      delete item.loopCompletionKey;
      delete item.loopPeriod;
      db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item), item.id);
    }
    db.prepare("INSERT INTO settings (key,value) VALUES ('loop-ledger-v1','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  });
  if (rows.length) console.log(`[startup] 已迁移 ${rows.length} 条循环任务到 ID 台账（${imported} 次完成记录）`);
}

migrateLoopLedger();

// Preserve old DAILY checklists as ordinary Daily tasks once, then leave their
// lifecycle to the same status and LOOP rules as every other column.
function migrateLegacyDaily() {
  if (db.prepare("SELECT 1 FROM settings WHERE key='daily-migrated'").get()) return;
  const rows = db.prepare(`SELECT i.id,i.text,i.position,i.created_at AS createdAt,
      (SELECT COUNT(*) FROM daily_completions c WHERE c.item_id=i.id) AS completedCount,
      (SELECT MAX(completed_at) FROM daily_completions c WHERE c.item_id=i.id) AS lastCompletedAt
    FROM daily_items i WHERE i.deleted_at='' ORDER BY i.position,i.created_at`).all();
  transaction(() => {
    for (const [index, row] of rows.entries()) {
      const id = 'daily-' + row.id;
      const complete = Number(row.completedCount) > 0;
      const item = {
        id, domain: 'Daily', type: 'todo', status: complete ? 'done' : 'open',
        title: row.text, content: '', prefixLabel: '', loop: '',
        position: index, createdAt: row.createdAt, updatedAt: row.lastCompletedAt || row.createdAt,
        completedAt: complete ? row.lastCompletedAt || row.createdAt : null, removedAt: null,
        sourceId: row.id
      };
      db.prepare('INSERT OR IGNORE INTO entries VALUES (?,?)').run(id, JSON.stringify(item));
    }
    db.prepare("INSERT INTO settings (key,value) VALUES ('daily-migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  });
  if (rows.length) console.log(`[startup] 已将 ${rows.length} 条 DAILY 事项转换为普通任务`);
}

migrateLegacyDaily();

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({limit: '12mb'}));

function verifyPassword(password, stored) {
  try {
    const [salt, hex] = stored.split(':');
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(hex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const loginFailures = new Map();

function cookie(req, name) {
  return (req.headers.cookie || '').split(';').map(value => value.trim().split('=')).find(([key]) => key === name)?.[1] || '';
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `rafa_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function cleanupExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

function isAuthenticated(req) {
  const token = cookie(req, 'rafa_session');
  if (!token) return false;
  const session = db.prepare('SELECT expires_at FROM sessions WHERE token=?').get(token);
  if (session?.expires_at > Date.now()) return true;
  if (session) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  return false;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({error: '需要登录'});
}

cleanupExpiredSessions();

app.use('/api', (req, res, next) => {
  if (['/auth/status', '/auth/login', '/auth/logout'].includes(req.path)) return next();
  requireAuth(req, res, next);
});
app.get('/api/auth/status', (req, res) => res.json({
  authenticated: isAuthenticated(req),
  configured: Boolean(db.prepare('SELECT 1 FROM settings WHERE key=?').get('passwordHash'))
}));
app.post('/api/auth/login', (req, res) => {
  const stored = db.prepare('SELECT value FROM settings WHERE key=?').get('passwordHash')?.value;
  if (!stored) return res.status(503).json({error: '尚未设置登录密码，请运行 scripts/set-password.mjs'});
  const key = req.ip, now = Date.now(), failure = loginFailures.get(key);
  if (failure?.until > now && failure.count >= 5) return res.status(429).json({error: '尝试次数过多，请稍后再试'});
  if (typeof req.body.password !== 'string' || !verifyPassword(req.body.password, stored)) {
    const count = failure?.until > now ? failure.count + 1 : 1;
    loginFailures.set(key, {count, until: now + 15 * 60 * 1000});
    return res.status(401).json({error: '密码错误'});
  }
  loginFailures.delete(key);
  cleanupExpiredSessions();
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?,?)').run(token, now + SESSION_AGE);
  setSessionCookie(res, token);
  res.json({authenticated: true});
});
app.post('/api/auth/logout', (req, res) => {
  const token = cookie(req, 'rafa_session');
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', 'rafa_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({authenticated: false});
});

const types = ['todo', 'text', 'link', 'image', 'group', 'bullet', 'divider'];
app.post('/api/link-preview', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({error: '链接必须使用 http 或 https'});
  try {
    const response = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(5000), headers: {'User-Agent': 'RafaTodo/1.0'}});
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html')) return res.json({title: ''});
    const html = (await response.text()).slice(0, 512000);
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (match?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, 200);
    res.json({title});
  } catch {
    res.json({title: ''});
  }
});
app.post('/api/ai/parse', async (req, res) => {
  const input = typeof req.body?.input === 'string' ? req.body.input.trim() : '';
  if (!input) return res.status(400).json({error: '请输入要录入的内容'});
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(503).json({error: '尚未配置 DEEPSEEK_API_KEY'});
  const system = `你是 RafaTodo 的录入助手。把用户输入拆成一条或多条待办事项，只返回 JSON，不要 Markdown。JSON 格式必须是 {"items":[{"title":"任务标题","content":"完整补充说明","domain":"Work|Life|Glean & Idea","owner":"负责人或空字符串","people":"其他参与人，用逗号分隔或空字符串","tags":"标签，用逗号分隔","dueDate":"YYYY-MM-DD 或空字符串","planDate":"YYYY-MM-DD 或空字符串","followupDate":"YYYY-MM-DD 或空字符串","stage":"阶段或空字符串","priority":"normal|high|urgent"}]}。没有明确的信息就留空；不要编造日期、负责人或状态。普通想法也转成一条 todo。`;
  try {
    const response = await fetch(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
      body: JSON.stringify({model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', messages: [{role: 'system', content: system}, {role: 'user', content: input}], thinking: {type: 'enabled'}, reasoning_effort: 'high', stream: false})
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'DeepSeek 请求失败');
    const raw = payload.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const items = (Array.isArray(parsed) ? parsed : parsed.items).filter(item => item && typeof item.title === 'string' && item.title.trim()).slice(0, 20).map(item => ({
      title: item.title.trim().slice(0, 1000),
      content: typeof item.content === 'string' ? item.content.trim().slice(0, 50000) : '',
      domain: domains.includes(item.domain) ? item.domain : 'Work',
      owner: typeof item.owner === 'string' ? item.owner.trim().slice(0, 100) : '',
      people: typeof item.people === 'string' ? item.people.trim().slice(0, 500) : '',
      tags: typeof item.tags === 'string' ? item.tags.slice(0, 500) : '',
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate || '') ? item.dueDate : '',
      planDate: /^\d{4}-\d{2}-\d{2}$/.test(item.planDate || '') ? item.planDate : '',
      followupDate: /^\d{4}-\d{2}-\d{2}$/.test(item.followupDate || '') ? item.followupDate : '',
      stage: typeof item.stage === 'string' ? item.stage.trim().slice(0, 100) : '',
      priority: ['normal', 'high', 'urgent'].includes(item.priority) ? item.priority : 'normal',
      type: 'todo', status: 'open', parentId: ''
    }));
    if (!items.length) throw new Error('AI 没有识别出可录入的任务');
    res.json({items});
  } catch (error) {
    res.status(502).json({error: error.message || 'AI 录入失败'});
  }
});

function activityDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function recordActivity(domain, counts, date = activityDate()) {
  if (!domains.includes(domain)) return;
  const values = {created_count: 0, completed_count: 0, updated_count: 0, removed_count: 0, ...counts};
  db.prepare(`INSERT INTO activity_daily (date,domain,created_count,completed_count,updated_count,removed_count) VALUES (?,?,?,?,?,?) ON CONFLICT(date,domain) DO UPDATE SET created_count=created_count+excluded.created_count,completed_count=completed_count+excluded.completed_count,updated_count=updated_count+excluded.updated_count,removed_count=removed_count+excluded.removed_count`).run(date, domain, values.created_count, values.completed_count, values.updated_count, values.removed_count);
}

function pinCount(domain, excludeId = '') {
  return db.prepare("SELECT COUNT(*) AS count FROM entries WHERE json_extract(data, '$.domain')=? AND json_extract(data, '$.archivedAt') IS NULL AND json_extract(data, '$.pinnedAt') > '' AND id<>?").get(domain, excludeId).count;
}

function uploadFilesIn(item) {
  const found = new Set();
  for (const match of JSON.stringify(item).matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)) found.add(match[1]);
  return [...found];
}

function cleanupDeletedUploads(item) {
  const files = uploadFilesIn(item);
  if (!files.length) return;
  for (const file of files) {
    if (db.prepare("SELECT 1 FROM entries WHERE instr(data, ?) > 0 LIMIT 1").get('/uploads/' + file)) continue;
    try {
      unlinkSync(path.join(uploadDir, file));
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('[uploads] 清理失败:', file, error.message);
    }
  }
}

app.delete('/api/entries/:id', (req, res) => {
  const row = db.prepare('SELECT data FROM entries WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({error: '条目不存在'});
  const deleted = JSON.parse(row.data), now = new Date().toISOString();
  transaction(() => {
    const linkedIds = db.prepare('SELECT owner_id FROM entry_links WHERE target_id=?').all(deleted.id).map(row => row.owner_id);
    db.prepare('DELETE FROM entries WHERE id=?').run(deleted.id);
    db.prepare('DELETE FROM loop_completions WHERE entry_id=?').run(deleted.id);
    for (const id of linkedIds) {
      const currentRow = db.prepare('SELECT data FROM entries WHERE id=?').get(id);
      if (!currentRow) continue;
      const current = JSON.parse(currentRow.data);
      if (current.parentId === deleted.id) current.parentId = deleted.parentId || '';
      current.dependencies = (current.dependencies || []).filter(link => link !== deleted.id);
      current.related = (current.related || []).filter(link => link !== deleted.id);
      current.updatedAt = now;
      db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(current), current.id);
    }
    compactStoredEntries();
  });
  cleanupDeletedUploads(deleted);
  res.json(unarchivedEntries());
});

app.get('/api/entries', (req, res) => {
  res.json(unarchivedEntries());
});
app.get('/api/entries/:id/loop-history', (req, res) => {
  if (!db.prepare('SELECT 1 FROM entries WHERE id=?').get(req.params.id)) return res.status(404).json({error: '条目不存在'});
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  const limit = 50;
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM loop_completions WHERE entry_id=?').get(req.params.id).count);
  const records = db.prepare('SELECT loop_kind AS loop, period_key AS period, completed_at AS completedAt FROM loop_completions WHERE entry_id=? ORDER BY completed_at DESC,period_key DESC,loop_kind LIMIT ? OFFSET ?').all(req.params.id, limit, offset);
  res.json({entryId: req.params.id, timeZone: LOOP_TIME_ZONE, total, records, nextOffset: offset + records.length < total ? offset + records.length : null});
});
app.get('/api/archive', (req, res) => res.json(archivedEntries()));
app.post('/api/archive', (req, res) => {
  const domain = req.body?.domain;
  if (!domains.includes(domain)) return res.status(400).json({error: '请选择归档领域'});
  const now = new Date().toISOString();
  let count = 0;
  transaction(() => {
    const items = rowsForDomainAndDescendants(domain);
    const children = new Map();
    for (const item of items) {
      if (!children.has(item.parentId)) children.set(item.parentId, []);
      children.get(item.parentId).push(item);
    }
    const eligible = new Map();
    function canArchive(item, visiting = new Set()) {
      // Keeping recurring children visible also prevents their ancestors from being archived.
      if (item.type === 'todo' && ['day', 'week'].includes(item.loop)) return false;
      if (eligible.has(item.id)) return eligible.get(item.id);
      if (visiting.has(item.id)) return false;
      visiting.add(item.id);
      const finished = item.type !== 'todo' || ['done', 'removed'].includes(item.status);
      const allowed = Boolean(item.archivedAt || (finished && item.domain === domain && (children.get(item.id) || []).every(child => canArchive(child, visiting))));
      visiting.delete(item.id);
      eligible.set(item.id, allowed);
      return allowed;
    }
    const archiveIds = new Set();
    function includeSubtree(item) {
      if (archiveIds.has(item.id) || item.archivedAt) return;
      archiveIds.add(item.id);
      for (const child of children.get(item.id) || []) includeSubtree(child);
    }
    // Open notes are eligible as descendants, not independent archive targets.
    for (const item of items) {
      if (!item.archivedAt && ['done', 'removed'].includes(item.status) && canArchive(item)) includeSubtree(item);
    }
    for (const item of items) {
      if (!archiveIds.has(item.id)) continue;
      item.archivedAt = now;
      item.updatedAt = now;
      db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify(item), item.id);
      count++;
    }
    compactStoredEntries();
  });
  res.json({count, items: unarchivedEntries()});
});
app.get('/api/activity', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const domain = domains.includes(req.query.domain) ? req.query.domain : '';
  const rows = db.prepare(`SELECT date,domain,created_count AS created,completed_count AS completed,updated_count AS updated,removed_count AS removed FROM activity_daily WHERE (?='' OR date>=?) AND (?='' OR date<=?) AND (?='' OR domain=?) ORDER BY date`).all(from, from, to, to, domain, domain);
  res.json(rows);
});
app.post('/api/entries', (req, res) => {
  const now = new Date().toISOString();
  const status = req.body.status || 'open';
  const domain = typeof req.body.domain === 'string' ? req.body.domain : '';
  const domainEntries = db.prepare("SELECT data FROM entries WHERE json_extract(data, '$.domain')=?").all(domain).map(row => JSON.parse(row.data));
  const position = nextPosition(domainEntries, {domain, parentId: req.body.parentId || '', workPane: req.body.workPane || ''});
  const item = {
    ...req.body,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    completedAt: req.body.type === 'todo' && status === 'done' ? now : null,
    removedAt: status === 'removed' ? now : null,
    status,
    position
  };
  if (item.prefixLabel === undefined) item.prefixLabel = '';
  save(item, res, () => {
    if (item.type === 'todo' && ['day', 'week'].includes(item.loop) && item.status === 'done') setLoopCompletion(item, true);
    recordActivity(item.domain, {created_count: 1});
  });
});
app.post('/api/entries/move', (req, res) => {
  try {
    const old = readEntries();
    const next = moveEntries(old, req.body).map(item => req.body.placement === 'inside' && item.id === req.body.targetId ? {...item, collapsed: false} : item);
    if (domains.some(domain => next.filter(item => !item.archivedAt && item.domain === domain && item.pinnedAt).length > 3)) throw new Error('每个栏目最多置顶 3 条');
    const byId = new Map(next.map(item => [item.id, item]));
    for (const item of next) {
      const visited = new Set();
      const reaches = id => {
        if (id === item.id) return true;
        if (visited.has(id)) return false;
        visited.add(id);
        const entry = byId.get(id);
        return entry && [entry.parentId, ...(entry.dependencies || [])].filter(Boolean).some(reaches);
      };
      if ([item.parentId, ...(item.dependencies || [])].filter(Boolean).some(reaches)) throw new Error('任务关系不能形成循环');
    }
    const compacted = compactEntryPositions(next);
    const movedId = req.body.id;
    const movedDomain = compacted.find(item => item.id === movedId)?.domain || old.find(item => item.id === movedId)?.domain;
    transaction(() => {
      let touched = false;
      persistChangedEntries(old, compacted, {
        touch: (item, before) => {
          const structural = item.id === movedId || !positionOnlyChange(before, item);
          if (structural) touched = true;
          return structural;
        }
      });
      if (touched) recordActivity(movedDomain, {updated_count: 1});
    });
    res.json(unarchivedEntries());
  } catch (error) {
    res.status(400).json({error: error.message});
  }
});
app.post('/api/entries/batch', (req, res) => {
  const {ids, action, domain, workPane} = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string') || !['done', 'removed', 'move'].includes(action)) return res.status(400).json({error: '请选择 1–200 个任务和有效操作'});
  try {
    const selected = [...new Set(ids)];
    transaction(() => {
      const old = readEntries(), byId = new Map(old.map(item => [item.id, item]));
      if (selected.some(id => !byId.has(id) || byId.get(id).archivedAt || byId.get(id).type !== 'todo')) throw new Error('部分任务已不存在或已归档，请刷新后重新选择');
      if (action === 'move') {
        const result = batchMoveEntries(old, selected, domain, workPane);
        if (domains.some(name => result.items.filter(item => !item.archivedAt && item.domain === name && item.pinnedAt).length > 3)) throw new Error('目标栏目最多置顶 3 条，请先取消部分置顶');
        persistChangedEntries(old, compactEntryPositions(result.items), {touch: (item, before) => !positionOnlyChange(before, item)});
        for (const item of result.roots) recordActivity(domain, {updated_count: 1});
      } else {
        const now = new Date().toISOString();
        for (const id of selected) {
          if (byId.get(id).status === action) continue;
          const row = db.prepare('SELECT data FROM entries WHERE id=?').get(id);
          updateStoredEntry(JSON.parse(row.data), {status: action}, now);
        }
      }
    });
    res.json({count: selected.length, items: unarchivedEntries()});
  } catch (error) { res.status(400).json({error: error.message}); }
});
app.post('/api/entries/import', (req, res) => {
  const {text, domain, parentId = '', workPane = '', targetId = '', replaceId = '', placement = 'after'} = req.body || {};
  if (typeof text !== 'string' || text.length > 200000 || !domains.includes(domain) || !['before', 'after'].includes(placement)) return res.status(400).json({error: '请检查粘贴内容和目标位置'});
  const lines = pastedLines(text);
  if (!lines.length || lines.length > 200) return res.status(400).json({error: '一次可拆分 1–200 个非空行'});
  try {
    const ids = [];
    transaction(() => {
      const existing = readEntries(), byId = new Map(existing.map(item => [item.id, item]));
      const target = byId.get(targetId), parent = byId.get(parentId), replaced = byId.get(replaceId);
      if (targetId && (!target || target.archivedAt || target.domain !== domain)) throw new Error('插入位置已失效，请重新选择');
      if (parentId && (!parent || parent.archivedAt || parent.domain !== domain)) throw new Error('父条目已不存在');
      if (replaceId && (!replaced || replaced.archivedAt || replaced.domain !== domain)) throw new Error('原任务已不存在，请先保留原文');
      const actualParentId = replaced ? replaced.parentId || '' : target ? target.parentId || '' : parentId;
      const panes = entryUtils.workPaneMap(existing);
      const pane = domain === 'Work' ? panes.get(replaced?.id || target?.id || parent?.id) || entryUtils.validWorkPane(workPane) : '';
      let cursor = targetId;
      const now = new Date().toISOString();
      for (const line of lines) {
        if (replaced && ids.length === 0) {
          const raw = JSON.parse(db.prepare('SELECT data FROM entries WHERE id=?').get(replaceId).data);
          const parsed = entryUtils.parseLine(line, raw, existing);
          updateStoredEntry(raw, parsed, now);
          ids.push(replaceId);cursor = replaceId;
          continue;
        }
        const parsed = entryUtils.parseLine(line, {domain, parentId: actualParentId, workPane: pane}, existing);
        const item = {...parsed, id: randomUUID(), position: nextPosition(readEntries(), {domain, parentId: actualParentId, workPane: pane}), createdAt: now, updatedAt: now, completedAt: parsed.type === 'todo' && parsed.status === 'done' ? now : null, removedAt: parsed.status === 'removed' ? now : null};
        storeEntry(item, () => {
          if (item.type === 'todo' && ['day', 'week'].includes(item.loop) && item.status === 'done') setLoopCompletion(item, true, new Date(now));
          recordActivity(domain, {created_count: 1});
        });
        ids.push(item.id);
        if (cursor) {
          const before = readEntries();
          persistChangedEntries(before, moveEntries(before, {id: item.id, targetId: cursor, domain, placement: ids.length === 1 ? placement : 'after'}));
        }
        cursor = item.id;
      }
      if (actualParentId) {
        const row = db.prepare('SELECT data FROM entries WHERE id=?').get(actualParentId);
        const value = row && JSON.parse(row.data);
        if (value?.collapsed) db.prepare('UPDATE entries SET data=? WHERE id=?').run(JSON.stringify({...value, collapsed: false, updatedAt: now}), actualParentId);
      }
      compactStoredEntries();
    });
    res.json({count: ids.length, ids, items: unarchivedEntries()});
  } catch (error) { res.status(400).json({error: error.message}); }
});
function updateStoredEntry(old, patch, now = new Date().toISOString()) {
  const hydratedOld = hydrateLoopEntry({...old}, new Date());
  const oldCompleted = hydratedOld.status === 'done';
  const oldLoop = ['day', 'week'].includes(old.loop) ? old.loop : '';
  const item = {...old, ...patch, id: old.id, createdAt: old.createdAt, updatedAt: now};
  if (item.type !== 'todo' || !['day', 'week'].includes(item.loop)) item.loop = '';
  const loopKindChanged = Boolean(oldLoop && item.loop && oldLoop !== item.loop);
  if (loopKindChanged) {
    // Changing the recurrence rule starts a new cycle. Keep historical
    // completions, but do not turn the switch itself into a completion.
    item.status = 'open';
    item.completedAt = null;
  }
  for (const key of ['loopCompletedCount', 'loopCompletionKey', 'loopPeriod']) delete item[key];
  item.completedAt = item.type === 'todo' ? (item.status === 'done' ? (old.completedAt || now) : item.status === 'removed' ? old.completedAt : null) : null;
  item.removedAt = item.status === 'removed' ? (old.status === 'removed' ? old.removedAt : now) : null;
  const counts = {updated_count: 1};
  if (!oldCompleted && item.status === 'done') counts.completed_count = 1;
  if (old.status !== 'removed' && item.status === 'removed') counts.removed_count = 1;
  return storeEntry(item, () => {
    if (old.type === 'todo' && ['day', 'week'].includes(old.loop) && oldCompleted && item.status !== 'done' && !loopKindChanged) {
      setLoopCompletion({...old, id: old.id}, false, new Date(now));
    }
    if (item.type === 'todo' && ['day', 'week'].includes(item.loop) && item.status === 'done' && !oldCompleted) setLoopCompletion(item, true, new Date(now));
    recordActivity(item.domain, counts);
  });
}
app.put('/api/entries/:id', (req, res) => {
  const row = db.prepare('SELECT data FROM entries WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({error: '条目不存在'});
  try { res.json(transaction(() => updateStoredEntry(JSON.parse(row.data), req.body))); }
  catch (error) { res.status(400).json({error: error.message}); }
});
function storeEntry(item, onSaved) {
  if (item.type === 'todo' && item.status === 'done') item.pinnedAt = '';
  if (item.type !== 'divider' && !(item.title?.trim() || item.content?.trim() || item.url || item.image)) throw new Error('请填写内容');
  if (!domains.includes(item.domain) || !types.includes(item.type) || !['open', 'doing', 'waiting', 'done', 'removed'].includes(item.status) || typeof item.title !== 'string' || item.title.length > 1000 || typeof item.content !== 'string' || item.content.length > 50000) throw new Error('请检查条目内容');
  if (item.pinnedAt && !item.archivedAt && pinCount(item.domain, item.id) >= 3) throw new Error('每个栏目最多置顶 3 条');
  if (item.url && !/^https?:\/\//i.test(item.url)) throw new Error('链接必须使用 http 或 https');
  if (item.parentId === item.id || (item.dependencies || []).includes(item.id)) throw new Error('不能关联自己');
  const links = [item.parentId, ...(item.dependencies || [])].filter(Boolean);
  const reaches = (id, seen = new Set()) => {
    if (id === item.id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const row = db.prepare('SELECT data FROM entries WHERE id=?').get(id);
    if (!row) return false;
    const entry = JSON.parse(row.data);
    return [entry.parentId, ...(entry.dependencies || [])].filter(Boolean).some(next => reaches(next, seen));
  };
  if (links.some(id => reaches(id))) throw new Error('任务关系不能形成循环');
  db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?)').run(item.id, JSON.stringify(item));
  onSaved?.();
  return hydrateLoopEntry(item);
}
function save(item, res, onSaved) {
  try { res.json(transaction(() => storeEntry(item, onSaved))); }
  catch (error) { res.status(400).json({error: error.message}); }
}

app.post('/api/upload', (req, res) => {
  const {base64, mime} = req.body;
  const ext = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}[mime];
  if (!ext) return res.status(400).json({error: '支持 PNG、JPEG、WebP、GIF 图片'});
  const bytes = Buffer.from(base64 || '', 'base64');
  if (bytes.length > 8 * 1024 * 1024) return res.status(400).json({error: '图片不能超过 8MB'});
  const file = randomUUID() + '.' + ext;
  writeFileSync(path.join(uploadDir, file), bytes);
  res.json({url: '/uploads/' + file});
});
app.use('/uploads', requireAuth, express.static(uploadDir));
app.use('/uploads', (req, res) => res.status(404).type('text/plain').send('Not found'));
app.use(express.static('dist'));
app.use('/assets', (req, res) => res.status(404).type('text/plain').send('Not found'));
app.get('/{*splat}', (req, res) => res.sendFile(path.resolve('dist/index.html')));
app.use((err, req, res, next) => res.status(500).json({error: '保存失败，请重试'}));
app.listen(process.env.PORT || 3001, process.env.HOST || '127.0.0.1', () => console.log('RafaTodo http://localhost:' + (process.env.PORT || 3001)));
