// echoNotes backend — Express + SQLite (node:sqlite) + JWT. Serves frontend too.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'echonotes-dev-secret-change-me';
const fs = require('fs');
const multer = require('multer');
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Video/audio uploads (for transcription). Files stored in server/uploads/
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 200 * 1024 * 1024 } });
app.use('/uploads', express.static(uploadDir));

// Serve frontend (../index.html, app.js, styles.css) so one URL does everything
app.use(express.static(path.join(__dirname, '..')));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'login required' });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { return res.status(401).json({ error: 'invalid token' }); }
}

// --- Auth ---
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username + password required' });
  if (db.findUser(username)) return res.status(409).json({ error: 'user exists' });
  const passhash = await bcrypt.hash(password, 10);
  const u = db.createUser(username, passhash);
  res.json({ token: jwt.sign({ id: u.id, username }, SECRET, { expiresIn: '7d' }), username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const u = db.findUser(username);
  if (!u || !(await bcrypt.compare(password, u.passhash))) return res.status(401).json({ error: 'invalid login' });
  res.json({ token: jwt.sign({ id: u.id, username: u.username }, SECRET, { expiresIn: '7d' }), username: u.username });
});

app.get('/api/me', auth, (req, res) => res.json({ username: req.user.username }));

// --- Lectures (Library) ---
app.get('/api/lectures', auth, (req, res) => res.json(db.listLectures(req.user.id)));
app.post('/api/lectures', auth, (req, res) => {
  const { id, title, data } = req.body || {};
  if (!title || !data) return res.status(400).json({ error: 'title + data required' });
  res.json(db.saveLecture(req.user.id, { id: id || ('lec_' + Date.now()), title, date: new Date().toLocaleString(), data }));
});
app.delete('/api/lectures/:id', auth, (req, res) => { db.deleteLecture(req.user.id, req.params.id); res.json({ ok: true }); });

// --- Terms ---
app.get('/api/terms', auth, (req, res) => res.json(db.listTerms(req.user.id)));
app.post('/api/terms', auth, (req, res) => {
  const { term, def, lec } = req.body || {};
  if (!term) return res.status(400).json({ error: 'term required' });
  res.json(db.addTerm(req.user.id, term, def, lec));
});
app.delete('/api/terms/:id', auth, (req, res) => { db.deleteTerm(req.user.id, req.params.id); res.json({ ok: true }); });

// --- Chat per lecture ---
app.get('/api/chats/:lectureId', auth, (req, res) => res.json(db.listChats(req.user.id, req.params.lectureId)));
app.post('/api/chats/:lectureId', auth, (req, res) => {
  const { who, text } = req.body || {};
  if (!who || !text) return res.status(400).json({ error: 'who + text required' });
  db.addChat(req.user.id, req.params.lectureId, who, text);
  res.json({ ok: true });
});
app.delete('/api/chats/:lectureId', auth, (req, res) => { db.clearChats(req.user.id, req.params.lectureId); res.json({ ok: true }); });

// --- Video -> Transcript ---
// POST /api/transcribe (multipart field "media", optional "title").
// If OPENAI_API_KEY is set, forwards audio to OpenAI Whisper for real transcription.
// Otherwise stores the file and returns { mode:'live' } so the browser uses
// free built-in Speech Recognition (see Transcript tab) — no key needed.
app.post('/api/transcribe', upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no media file (field "media")' });
    const title = req.body.title || req.file.originalname || 'Untitled lecture';
    const fileUrl = '/uploads/' + req.file.filename;
    const key = process.env.OPENAI_API_KEY;
    if (key) {
      const FormDataCtor = globalThis.FormData;
      const BlobCtor = globalThis.Blob;
      const buf = fs.readFileSync(req.file.path);
      const fd = new FormDataCtor();
      fd.append('file', new BlobCtor([buf]), req.file.originalname || 'audio.webm');
      fd.append('model', 'whisper-1');
      fd.append('response_format', 'verbose_json');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd,
      });
      if (!r.ok) return res.status(502).json({ error: 'whisper failed: ' + (await r.text()).slice(0, 300), fileUrl, title });
      const j = await r.json();
      const segments = (j.segments || []).map(s => ({ t: Math.round(s.start || 0), text: s.text.trim() }));
      return res.json({ mode: 'whisper', title, fileUrl, text: j.text, segments: segments.length ? segments : [{ t: 0, text: j.text }] });
    }
    return res.json({ mode: 'live', title, fileUrl, message: 'Stored. No OPENAI_API_KEY set — use browser Live Transcription (free, no key) in the Transcript tab while the video plays.' });
  } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
});

// --- YouTube -> Transcript (captions, no API key needed) ---
// GET /api/youtube-transcript?url=<youtube url>  — returns { videoId, title, segments:[{t,text}] }
function ytId(u) {
  const m = String(u || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}
function decodeXml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
app.get('/api/youtube-transcript', async (req, res) => {
  try {
    const id = ytId(req.query.url || req.query.id || '');
    if (!id) return res.status(400).json({ error: 'invalid YouTube link' });
    const page = await fetch('https://www.youtube.com/watch?v=' + id, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!page.ok) return res.status(502).json({ error: 'youtube fetch failed: HTTP ' + page.status });
    const html = await page.text();
    const titleM = html.match(/<title>([^<]*)<\/title>/);
    const title = titleM ? decodeXml(titleM[1].replace(' - YouTube', '')) : ('YouTube ' + id);
    // balanced-bracket extraction (regex truncates the array and breaks baseUrl)
    function extractTracks(h) {
      const key = '"captionTracks":';
      const i = h.indexOf(key);
      if (i < 0) return null;
      let j = h.indexOf('[', i);
      const start = j;
      let depth = 0, inStr = false, esc = false;
      for (; j < h.length; j++) {
        const c = h[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
        else { if (c === '"') inStr = true; else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) break; } }
      }
      if (depth !== 0) return null;
      try { return JSON.parse(h.slice(start, j + 1).replace(/\\u0026/g, '&')); } catch { return null; }
    }
    function parseXml(xml) {
      return [...xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)]
        .map(m => ({ t: Math.floor(parseFloat(m[1])), text: decodeXml(m[2]) }))
        .filter(s => s.text);
    }
    function parseVtt(vtt) {
      const out = [];
      const re = /(\d+:)?(\d+):(\d+)\.\d+\s*-->\s*(\d+:)?(\d+):(\d+)\.\d+\s*\n([\s\S]*?)(?=\n\n|\n*$)/g;
      let m;
      while ((m = re.exec(vtt))) {
        const t = (m[1] ? parseInt(m[1]) * 3600 : 0) + parseInt(m[2]) * 60 + parseInt(m[3]);
        out.push({ t, text: decodeXml(m[7]) });
      }
      return out.filter(s => s.text);
    }
    async function fetchTrack(url) {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const txt = await r.text();
      let segs = parseXml(txt);
      if (!segs.length && txt.includes('-->')) segs = parseVtt(txt);
      return segs;
    }
    function parseSrv3(xml) {
      return [...xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)]
        .map(m => ({ t: Math.floor(parseInt(m[1]) / 1000), text: decodeXml(m[2]) }))
        .filter(s => s.text);
    }
    const origFetchTrack = fetchTrack;
    fetchTrack = async (url) => {
      let segs = await origFetchTrack(url);
      if (!segs.length) {
        try {
          const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const txt = await r.text();
          segs = parseSrv3(txt);
        } catch {}
      }
      return segs;
    };
    let tracks = extractTracks(html);
    let segs = [];
    // Fresh-token InnerTube URLs work server-side; scraped page URLs are often expired
    try {
      const pr = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/20.10.38' },
        body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en', gl: 'US' } }, videoId: id }),
      });
      if (pr.ok) {
        const pj = await pr.json();
        const it = ((((pj || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []);
        if (it.length) tracks = it;
      }
    } catch {}
    if (tracks && tracks.length) {
      tracks.sort((a, b) => (((b.languageCode || '') === 'en') - ((a.languageCode || '') === 'en')) || (((b.languageCode || '').startsWith('en')) - ((a.languageCode || '').startsWith('en'))));
      for (const tr of tracks.slice(0, 3)) {
        try {
          segs = await fetchTrack(tr.baseUrl);
          if (!segs.length) segs = await fetchTrack(tr.baseUrl + '&fmt=vtt');
          if (segs.length) break;
        } catch {}
      }
    }
    if (!segs.length) {
      // legacy caption endpoint fallback
      for (const lang of ['en', 'en-US']) {
        try {
          segs = await fetchTrack(`https://video.google.com/timedtext?lang=${lang}&v=${id}`);
          if (segs.length) break;
        } catch {}
      }
    }
    if (!tracks) return res.status(404).json({ error: 'No captions found for this video (owner disabled them). Try Live Transcription while it plays, or upload the file.', videoId: id, title });
    if (!segs.length) return res.status(404).json({ error: 'Captions empty for this video.', videoId: id, title });
    // merge lines within same 8s window for readable segments
    const merged = [];
    for (const s of segs) {
      const last = merged[merged.length - 1];
      if (last && s.t - last.t < 8) last.text += ' ' + s.text; else merged.push({ ...s });
    }
    res.json({ videoId: id, title, segments: merged.slice(0, 500) });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- AI study engine (Groq). Local offline pipeline in app.js is the fallback. ---
let GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const ENV_FILE = path.join(__dirname, '.env');
function persistGroqKey(key) {
  GROQ_KEY = key;
  try {
    let txt = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    if (/^GROQ_API_KEY=/m.test(txt)) txt = txt.replace(/^GROQ_API_KEY=.*$/m, 'GROQ_API_KEY=' + key);
    else txt += (txt.endsWith('\n') || !txt ? '' : '\n') + 'GROQ_API_KEY=' + key + '\n';
    fs.writeFileSync(ENV_FILE, txt);
  } catch (e) { console.log('could not persist key:', e.message); }
}
async function checkGroqKey(key) {
  const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('Groq rejected the key (HTTP ' + r.status + ') — copy a fresh one from console.groq.com/keys');
}
// GET /api/ai-status -> { configured, model } (never exposes the key)
app.get('/api/ai-status', (req, res) => res.json({ configured: !!GROQ_KEY, model: GROQ_MODEL }));
// POST /api/ai-key { key } -> validates with Groq, saves to .env, hot-reloads
app.post('/api/ai-key', async (req, res) => {
  try {
    const key = String((req.body || {}).key || '').trim();
    if (!/^gsk_[A-Za-z0-9]{10,}$/.test(key)) return res.status(400).json({ error: 'That does not look like a Groq key (it starts with gsk_)' });
    await checkGroqKey(key);
    persistGroqKey(key);
    res.json({ ok: true, model: GROQ_MODEL });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});
async function groqChat(messages, jsonMode) {
  if (!GROQ_KEY) throw new Error('AI not configured (GROQ_API_KEY missing)');
  const models = [GROQ_MODEL, 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr = '';
  for (const model of models) {
    const body = { model, messages, temperature: 0.3, max_tokens: 4000 };
    if (jsonMode) body.response_format = { type: 'json_object' };
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) {
      const j = await r.json();
      return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    }
    lastErr = 'HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200);
    if (!/model_not_found|does not exist|decommissioned/i.test(lastErr)) throw new Error('AI request failed: ' + lastErr);
  }
  throw new Error('AI request failed: ' + lastErr);
}
function mmss(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

// POST /api/ai-notes { title, segments:[{t,text}] } -> { notes, cards, topics }
app.post('/api/ai-notes', async (req, res) => {
  try {
    const { title, segments } = req.body || {};
    if (!segments || !segments.length) return res.status(400).json({ error: 'segments required' });
    const clipped = segments.slice(0, 150);
    const script = clipped.map(s => `[${mmss(s.t)}] ${s.text}`).join('\n').slice(0, 14000);
    const out = await groqChat([
      { role: 'system', content: 'You are echoNotes, an expert study assistant. Convert the lecture transcript into structured study material. Return ONLY valid JSON, no markdown, no commentary.' },
      { role: 'user', content: `Lecture: "${title || 'Untitled'}".\n\nTranscript (timestamps [mm:ss]):\n${script}\n\nReturn JSON exactly like:\n{"topics":[{"label":"..."}],"notes":[{"title":"...","ts":0,"level":"core"|"supporting","kind":"definition"|"cause"|"evidence"|"application"|"key","body":"..."}],"cards":[{"q":"...","a":"...","src":"..."}]}\n\nRules: 10-14 notes ordered by lecture time; "core" = exam-critical ideas, "supporting" = evidence/examples; kind must match content (definition/cause/evidence/application/key); ts = segment start in SECONDS (number) closest to where the idea is spoken; body = 1-3 condensed sentences in the lecturer's meaning, no invented facts; titles short ("Sigmoid Function — definition", "Evidence: ...", "Example: ...", "Why: ..."); 6-8 cards incl. definitional "What is X?" and the lecturer's own questions with their answers; card src like "10:32".` },
    ], true);
    let j;
    try { j = JSON.parse(out); } catch { return res.status(502).json({ error: 'AI returned invalid JSON' }); }
    const levels = new Set(['core', 'supporting']), kinds = new Set(['definition', 'cause', 'evidence', 'application', 'key']);
    const notes = (j.notes || []).filter(n => n && n.title && n.body).slice(0, 14).map(n => ({
      title: String(n.title).slice(0, 120), ts: Math.max(0, parseInt(n.ts) || 0),
      level: levels.has(n.level) ? n.level : 'supporting', kind: kinds.has(n.kind) ? n.kind : 'key',
      body: String(n.body).slice(0, 600), topic: String(n.topic || '').slice(0, 40),
    }));
    const cards = (j.cards || []).filter(c => c && c.q && c.a).slice(0, 8).map(c => ({
      q: String(c.q).slice(0, 200), a: String(c.a).slice(0, 600), src: String(c.src || '').slice(0, 60),
    }));
    const topics = (j.topics || []).filter(t => t && t.label).slice(0, 8).map(t => ({ label: String(t.label).slice(0, 24) }));
    if (!notes.length) return res.status(502).json({ error: 'AI returned no notes' });
    res.json({ notes, cards, topics });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// POST /api/ai-ask { question, title, notes, transcript } -> { answer }
app.post('/api/ai-ask', async (req, res) => {
  try {
    const { question, title, notes, transcript } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question required' });
    const ctx = [
      'Lecture: ' + (title || 'Untitled'),
      'Key notes:\n' + (notes || []).slice(0, 14).map(n => `- [${mmss(n.ts || 0)}] ${n.title}: ${n.body}`).join('\n'),
      'Transcript excerpt:\n' + String(transcript || '').slice(0, 9000),
    ].join('\n\n');
    const answer = await groqChat([
      { role: 'system', content: 'You are echoNotes tutor. Answer ONLY from the lecture material below. Be concise (2-5 sentences). Cite the timestamp [mm:ss] of supporting material. If the lecture does not cover it, say so.' },
      { role: 'user', content: ctx + '\n\nQuestion: ' + question },
    ], false);
    res.json({ answer });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// POST /api/ai-mindmap { title, notes:[{title,ts,level,kind,body}] } -> { root:{label,ts,children:[...]} }
app.post('/api/ai-mindmap', async (req, res) => {
  try {
    const { title, notes } = req.body || {};
    if (!notes || !notes.length) return res.status(400).json({ error: 'notes required' });
    const list = notes.slice(0, 14).map(n => `- [${mmss(n.ts || 0)}] (${n.level}/${n.kind}) ${n.title}: ${String(n.body || '').slice(0, 220)}`).join('\n');
    const out = await groqChat([
      { role: 'system', content: 'You are echoNotes. Build a hierarchical mindmap from lecture notes. Return ONLY valid JSON, no markdown, no commentary.' },
      { role: 'user', content: `Lecture: "${title || 'Untitled'}".\n\nNotes:\n${list}\n\nReturn JSON exactly like:\n{"root":{"label":"...","children":[{"label":"...","ts":0,"children":[{"label":"...","ts":0}]}]}}\n\nRules: root = the lecture's central topic (2-5 words); 3-6 main branches covering distinct sub-topics; each branch has 2-4 leaf details; every label 2-6 words, no invented facts, use lecture vocabulary; ts = timestamp in SECONDS (number) of a note supporting that node (0 if none).` },
    ], true);
    let j;
    try { j = JSON.parse(out); } catch { return res.status(502).json({ error: 'AI returned invalid JSON' }); }
    const cleanNode = (n, depth) => {
      if (!n || !n.label || depth > 2) return null;
      const kids = (n.children || []).slice(0, depth === 0 ? 6 : 4).map(k => cleanNode(k, depth + 1)).filter(Boolean);
      return { label: String(n.label).slice(0, 40), ts: Math.max(0, parseInt(n.ts) || 0), children: kids };
    };
    const root = cleanNode(j.root, 0);
    if (!root || !root.children.length) return res.status(502).json({ error: 'AI returned no branches' });
    res.json({ root });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.listen(PORT, () => console.log(`echoNotes server on http://localhost:${PORT} (sqlite=${db.isSqlite()})`));
