// SQLite via built-in node:sqlite (Node 22+). No native build needed. Falls back to JSON file if unavailable.
const path = require('path');
const fs = require('fs');

const DB_FILE = path.join(__dirname, 'echonotes.db');
let useSqlite = false;
let db = null;

try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, passhash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lectures (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS terms (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, term TEXT NOT NULL, def TEXT DEFAULT '', lec TEXT DEFAULT '', FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, lecture_id TEXT NOT NULL, who TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
  `);
  useSqlite = true;
  console.log('SQLite enabled:', DB_FILE);
} catch (e) {
  console.log('node:sqlite unavailable, using JSON fallback:', e.message);
}

const JSON_FILE = path.join(__dirname, 'data.json');
function loadJson() {
  try { return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8')); }
  catch { return { users: [], lectures: [], terms: [], chats: [], seq: 1 }; }
}
function saveJson(d) { fs.writeFileSync(JSON_FILE, JSON.stringify(d, null, 2)); }

module.exports = {
  isSqlite: () => useSqlite,
  createUser(username, passhash) {
    if (useSqlite) {
      const r = db.prepare('INSERT INTO users (username, passhash) VALUES (?, ?)').run(username, passhash);
      return { id: Number(r.lastInsertRowid), username };
    }
    const d = loadJson();
    if (d.users.find(u => u.username === username)) throw new Error('exists');
    const u = { id: d.seq++, username, passhash };
    d.users.push(u); saveJson(d); return { id: u.id, username };
  },
  findUser(username) {
    if (useSqlite) return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
    return loadJson().users.find(u => u.username === username) || null;
  },
  findUserById(id) {
    if (useSqlite) return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
    return loadJson().users.find(u => u.id === Number(id)) || null;
  },
  saveLecture(userId, lec) {
    if (useSqlite) {
      db.prepare('INSERT OR REPLACE INTO lectures (id, user_id, title, date, data) VALUES (?, ?, ?, ?, ?)').run(lec.id, userId, lec.title, lec.date, JSON.stringify(lec.data));
      return lec;
    }
    const d = loadJson();
    d.lectures = d.lectures.filter(x => !(x.id === lec.id && x.user_id === Number(userId)));
    d.lectures.unshift({ ...lec, user_id: Number(userId) }); saveJson(d); return lec;
  },
  listLectures(userId) {
    if (useSqlite) {
      return db.prepare('SELECT id, title, date, data FROM lectures WHERE user_id = ? ORDER BY rowid DESC').all(userId)
        .map(r => ({ id: r.id, title: r.title, date: r.date, data: JSON.parse(r.data) }));
    }
    return loadJson().lectures.filter(x => x.user_id === Number(userId));
  },
  deleteLecture(userId, id) {
    if (useSqlite) { db.prepare('DELETE FROM lectures WHERE id = ? AND user_id = ?').run(id, userId); return; }
    const d = loadJson();
    d.lectures = d.lectures.filter(x => !(x.id === id && x.user_id === Number(userId))); saveJson(d);
  },
  listTerms(userId) {
    if (useSqlite) return db.prepare('SELECT id, term, def, lec FROM terms WHERE user_id = ? ORDER BY id DESC').all(userId);
    return loadJson().terms.filter(x => x.user_id === Number(userId)).reverse();
  },
  addTerm(userId, term, def, lec) {
    if (useSqlite) {
      const r = db.prepare('INSERT INTO terms (user_id, term, def, lec) VALUES (?, ?, ?, ?)').run(userId, term, def || '', lec || '');
      return { id: Number(r.lastInsertRowid), term, def, lec };
    }
    const d = loadJson();
    const t = { id: d.seq++, user_id: Number(userId), term, def: def || '', lec: lec || '' };
    d.terms.push(t); saveJson(d); return t;
  },
  deleteTerm(userId, id) {
    if (useSqlite) { db.prepare('DELETE FROM terms WHERE id = ? AND user_id = ?').run(id, userId); return; }
    const d = loadJson();
    d.terms = d.terms.filter(x => !(x.id === Number(id) && x.user_id === Number(userId))); saveJson(d);
  },
  listChats(userId, lectureId) {
    if (useSqlite) return db.prepare('SELECT who, text FROM chats WHERE user_id = ? AND lecture_id = ? ORDER BY id ASC').all(userId, lectureId);
    return loadJson().chats.filter(x => x.user_id === Number(userId) && x.lecture_id === lectureId);
  },
  addChat(userId, lectureId, who, text) {
    if (useSqlite) { db.prepare('INSERT INTO chats (user_id, lecture_id, who, text) VALUES (?, ?, ?, ?)').run(userId, lectureId, who, text); return; }
    const d = loadJson();
    d.chats.push({ id: d.seq++, user_id: Number(userId), lecture_id: lectureId, who, text }); saveJson(d);
  },
  clearChats(userId, lectureId) {
    if (useSqlite) { db.prepare('DELETE FROM chats WHERE user_id = ? AND lecture_id = ?').run(userId, lectureId); return; }
    const d = loadJson();
    d.chats = d.chats.filter(x => !(x.user_id === Number(userId) && x.lecture_id === lectureId)); saveJson(d);
  }
};
