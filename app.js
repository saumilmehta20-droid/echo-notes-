// echoNotes — frontend prototype
// To plug real AI: replace runPipeline()/demoData with fetch() to /api/transcribe (Whisper) + /api/summarize (LLM).

const $ = id => document.getElementById(id);
const tabs = document.querySelectorAll('.tabs button');
tabs.forEach(b => b.onclick = () => {
  tabs.forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('tab-' + b.dataset.tab).classList.add('active');
});
const go = t => document.querySelector(`[data-tab="${t}"]`).click();

// Demo lecture — models your 4 problems: noise, emphasis/slide refs, far-apart links, core vs detail
function demoData(title) {
  return {
    title,
    transcript: [
      { t: 4,   text: "Can you hear me? Assignment due Friday, please submit.", noise: true, tag: "announcement" },
      { t: 32,  text: "Today: Photosynthesis — definition. THIS is important for exam.", core: true, ref: "Slide 2" },
      { t: 95,  text: "Uhh, repeating again, photosynthesis converts light to chemical energy.", noise: true, tag: "repetition" },
      { t: 150, text: "Definition: process where plants convert light + CO2 + water into glucose + oxygen.", core: true, kind: "definition", ref: "Slide 3" },
      { t: 320, text: "Look at this diagram on whiteboard — chlorophyll in chloroplast traps light.", core: true, kind: "cause", ref: "Whiteboard" },
      { t: 540, text: "Someone's mic is on, background noise... anyway light reaction needs water.", noise: true, tag: "background noise" },
      { t: 610, text: "Evidence: Engelmann experiment showed oxygen near red/blue light.", core: false, kind: "evidence" },
      { t: 890, text: "As defined earlier, glucose from photosynthesis is used in respiration — linking far-apart idea.", core: true, kind: "application", ref: "Slide 8" },
      { t: 1200,text: "Any questions? Okay digression about lab trip... back to topic.", noise: true, tag: "digression" },
      { t: 1280,text: "Application: crop yield improves when CO2 and light optimized in greenhouses.", core: false, kind: "application" },
    ],
    notes: [
      { title: "Definition: Photosynthesis", ts: 150, level: "core", kind: "definition", body: "Converts light + CO2 + H2O → glucose + O2. Central exam concept.", ref: "Slide 3" },
      { title: "Cause: Chlorophyll traps light", ts: 320, level: "core", kind: "cause", body: "Chlorophyll in chloroplast is the site. Emphasis: professor stressed THIS.", ref: "Whiteboard" },
      { title: "Evidence: Engelmann experiment", ts: 610, level: "supporting", kind: "evidence", body: "Oxygen clusters near red/blue wavelengths — proof of light dependence." },
      { title: "Application: Respiration link", ts: 890, level: "core", kind: "application", body: "Glucose made here fuels respiration later. Connects minute 2:30 idea to 14:50.", ref: "Slide 8" },
      { title: "Application: Greenhouse yield", ts: 1280, level: "supporting", kind: "application", body: "Example: raise CO2 + light to increase yield. Detail, not core definition." },
    ],
    cards: [
      { q: "Define photosynthesis.", a: "Light + CO2 + H2O → glucose + O2 in chloroplasts.", src: "02:30 • Slide 3" },
      { q: "What causes light capture?", a: "Chlorophyll in chloroplast traps light.", src: "05:20 • Whiteboard" },
      { q: "What evidence supports light dependence?", a: "Engelmann experiment: O2 near red/blue light.", src: "10:10" },
      { q: "How does photosynthesis link to respiration?", a: "Glucose produced here is fuel for respiration.", src: "14:50 • Slide 8" },
      { q: "Give one agricultural application.", a: "Optimize CO2 + light in greenhouses for yield.", src: "21:20" },
    ],
    graph: {
      nodes: [
        { id: "photo", label: "Photosynthesis", x: 360, y: 60 },
        { id: "chloro", label: "Chlorophyll", x: 150, y: 180 },
        { id: "glucose", label: "Glucose", x: 360, y: 180 },
        { id: "evidence", label: "Engelmann ev.", x: 570, y: 180 },
        { id: "resp", label: "Respiration", x: 250, y: 300 },
        { id: "green", label: "Greenhouse", x: 480, y: 300 },
      ],
      edges: [
        { a: "chloro", b: "photo", label: "causes" },
        { a: "photo", b: "glucose", label: "produces" },
        { a: "evidence", b: "photo", label: "proves" },
        { a: "glucose", b: "resp", label: "fuels (far link)" },
        { a: "photo", b: "green", label: "applied" },
      ]
    }
  };
}

let state = { data: null, cardIdx: 0, known: new Set() };
const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

function setVideo(file) {
  if (file) { $('player').src = URL.createObjectURL(file); $('nowPlaying').textContent = "Playing: " + file.name; }
}

$('fileInput').onchange = e => setVideo(e.target.files[0]);

// ---- YouTube link support (real video, real transcript) ----
let ytVideoId = null;
function parseYtId(u) {
  const m = String(u || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}
function setYouTube(url) {
  const id = parseYtId(url);
  ytVideoId = id;
  const wrap = $('ytWrap');
  if (id && wrap) {
    $('player').style.display = 'none';
    wrap.innerHTML = `<iframe width="100%" height="300" style="border-radius:10px" src="https://www.youtube.com/embed/${id}" frameborder="0" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    $('nowPlaying').textContent = 'YouTube: ' + url;
  } else if (wrap) {
    wrap.innerHTML = ''; $('player').style.display = '';
  }
  return id;
}
function seekTo(ts) {
  if (ytVideoId) { window.open(`https://www.youtube.com/watch?v=${ytVideoId}&t=${ts}s`, '_blank'); return; }
  try { $('player').currentTime = ts; $('player').play(); } catch {}
}

// ---- Real video -> transcript (free browser speech recognition + optional server Whisper) ----
let liveSegs = []; // {t, text}
let recog = null, liveOn = false;
function recogCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
function setLiveStatus(s) { const el = $('liveStatus'); if (el) el.textContent = s; }
function pushLive(text) {
  const t = Math.floor($('player').currentTime || 0);
  const last = liveSegs[liveSegs.length - 1];
  if (last && last.text === text) return;
  liveSegs.push({ t, text });
  const box = $('liveList');
  if (box) {
    const d = document.createElement('div');
    d.className = 'trow';
    d.innerHTML = `<span class="ts">[${fmt(t)}]</span> ${text}`;
    d.querySelector('.ts').onclick = () => seekTo(t);
    box.appendChild(d);
  }
}
$('liveBtn').onclick = () => {
  const C = recogCtor();
  if (!C) return alert('Speech recognition not supported — use Chrome/Edge.');
  if (liveOn) return;
  recog = new C();
  recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
  recog.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) pushLive(tr); else interim += tr + ' ';
    }
    setLiveStatus(liveOn ? ('Listening… ' + liveSegs.length + ' segments' + (interim ? ' | …' + interim.slice(0, 60) : '')) : 'Idle');
  };
  recog.onerror = e => setLiveStatus('Mic error: ' + e.error + ' — allow microphone, then retry.');
  recog.onend = () => { if (liveOn) { try { recog.start(); } catch {} } };
  try { recog.start(); liveOn = true; setLiveStatus('Listening… play the video (or speak). Segments: 0'); $('player').play().catch(() => {}); }
  catch (e) { alert('Could not start mic: ' + e.message); }
};
$('liveStop').onclick = () => { liveOn = false; try { recog && recog.stop(); } catch {} setLiveStatus('Stopped. Segments: ' + liveSegs.length + '. Now click "Build notes from transcript".'); };
$('uploadServerBtn').onclick = async () => {
  const f = $('fileInput').files[0];
  if (!f) return alert('Choose a video/audio file in the Upload tab first.');
  setLiveStatus('Uploading to server…');
  const fd = new FormData();
  fd.append('media', f); fd.append('title', $('lectureTitle').value || f.name);
  try {
    const r = await fetch(API_BASE + '/api/transcribe', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) return setLiveStatus('Upload failed: ' + (j.error || r.status));
    if (j.mode === 'whisper') {
      liveSegs = j.segments || [];
      setLiveStatus('Whisper done: ' + liveSegs.length + ' segments. Click "Build notes from transcript".');
      const box = $('liveList'); box.innerHTML = '';
      liveSegs.forEach(s => pushLive(s.text));
    } else setLiveStatus('Stored on server. ' + (j.message || ''));
  } catch (e) { setLiveStatus('Upload failed (server running? start with: node server.js): ' + e.message); }
};
// ---- Study pipeline: raw transcript -> structured conceptual notes (no API key) ----
// Stages: clean -> sentences -> score/classify -> topic clusters -> notes/cards/map.
const STOP = new Set('a,an,the,and,or,but,if,then,else,when,while,with,from,into,over,under,that,this,these,those,they,them,their,there,here,what,which,who,whom,whose,will,would,should,could,can,just,very,more,most,also,only,even,still,already,back,out,about,onto,per,via,its,it,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,not,no,yes,of,at,by,on,in,to,for,as,we,you,he,she,our,your,his,her,my,me,him,us,all,any,each,other,some,such,nor,too,own,same,so,than,s,t,d,ll,re,ve,don,doesn,isn,aren,wasn,let,lets,might,shall,must,need,needs,want,wants,going,gone,thing,things,something,anything,stuff,really,pretty,quite,rather,called,say,says,said,tell,talks,show,shows,showed,give,gives,going,put,find,feels,seem,seems,become,keep,tries,helps,works,means,makes,takes,uses,using,sees,looks,knows,thinks,gets,went,comes,likes'.split(','));
const RX = {
  nonspeech: /\[.*?\]|\(.*?music.*?\)|\(.*?applause.*?\)|\(.*?laughter.*?\)/i,
  noise: /(assignment|homework|due (on |by )?(friday|monday|tuesday|wednesday|thursday)|submit|office hours|email me|syllabus|can you hear|is this audible|\bmic\b|microphone|sorry about|welcome( back)?|thanks (everyone|for)|any questions\??$|see you (next|on)|don't forget to (subscribe|like)|smash( that)? (like|subscribe)|good (morning|afternoon|evening)( class| everyone)?$|let'?s get started$|before we (begin|start))/i,
  def: /(defined as|is called|are called|known as|referred to as|stands for|means that|we define|by definition|definition of)/i,
  important: /(important|key (point|idea|takeaway|concept)|remember|crucial|critical|exam|main point|bottom line|in summary|to summarize|the point is|takeaway)/i,
  cause: /(because|caused by|due to|leads to|results in|therefore|that'?s why|this is why|\bcauses?\b|effect of|as a result)/i,
  evidence: /(study|experiment|data|evidence|research|shows that|showed that|found that|proves?|measured|survey|trial|paper|results? show)/i,
  example: /(for example|for instance|such as|\be\.g\.|say you|imagine|suppose|in practice|application|used for|used to|case in point)/i,
  transition: /(moving on|next (topic|chapter|section|part|slide)|chapter \w+|let'?s turn to|switching gears|now (let'?s|we'?ll) (move|talk|look))/i,
  namedTerm: /\b(?:called|known as|referred to as|defined as)\s+([A-Za-z][A-Za-z0-9' -]{2,40})/,
  capPhrase: /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
  meta: /(i'?m (happy|going|gonna)|stick with the status quo|point you to|download the code|play with it|stay posted|subscribe|notifications? from youtube|patreon|thank you|funding for this video|stay tuned|see you (next|in the))/i,
};
const COMMON_START = new Set('Then,Now,And,But,So,Well,Also,There,Here,This,That,These,Those,What,When,Where,Even,Still,Just,Only,Right,Okay,Yes,No,Well,Of,In,On,At,To,For,With,You,We,They,It,An,A,The,As,By,Be,Is,Are,Was,Were,How,Why,Which,Who,All,Any,Each,More,Most,Some,Such,Than,Too,Very,Back,Out,Up,Down,Over,Under,Again,Once,May,Might,Can,Could,Will,Would,Should,Do,Does,Did,Have,Has,Had,One,Two,First,Let,Lets,Your,Our,Their,His,Her,Remember,Suppose,Imagine,Consider,Take,Look,See,Note,Say'.split(','));
function stemKey(w) { return String(w).toLowerCase().replace(/(ies)$/, 'y').replace(/(es|s|ed|ing)$/, ''); }
function leadStrip(s) {
  return String(s).replace(/^(for example|for instance|of course|well|so|now|then|actually|basically|moreover|however|therefore|what we'?ll do is|what i want to do is)[,\s]+/i, '')
    .replace(/^[a-z]/, c => c.toUpperCase());
}
function fitLabel(s, n) {
  s = String(s || '');
  if (s.length <= n) return s;
  const cut = s.lastIndexOf(' ', n - 1);
  return (cut > Math.floor(n / 2) ? s.slice(0, cut) : s.slice(0, n - 1)) + '…';
}
function cleanTerm(t) {
  return String(t || '').replace(/^(its|the|this|that|these|those|their|our|your|a|an)\s+/i, '').replace(/[.,;:!?]+$/, '').trim();
}
function cleanText(s) {
  return String(s || '')
    .replace(RX.nonspeech, ' ')
    .replace(/,\s*(um+|uh+|erm+|ah+)\b/gi, '')
    .replace(/\b(um+|uh+|erm+|ah+|mm+hmm)\b\.?/gi, '')
    .replace(/^(so|and then|and|but|now|okay|okay so|alright|well|right)[,\s]+/i, '')
    .replace(/\b(\w+)(\s+\1){2,}/gi, '$1')
    .replace(/\s+/g, ' ').trim();
}
function wordsOf(s) { return String(s).toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(Boolean); }
function contentWords(s) { return wordsOf(s).filter(w => w.length >= 5 && !STOP.has(w)); }
function splitSents(text) {
  const parts = String(text).split(/([.?!]["']?)\s+/);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = ((parts[i] || '') + (parts[i + 1] || '')).trim();
    if (s) out.push(s);
  }
  return out.length ? out : [String(text).trim()];
}
function hardSplit(words, maxWords) {
  // split long unpunctuated caption runs at discourse markers, else midpoint
  if (words.length <= maxWords) return [words.join(' ')];
  const marks = new Set(['then', 'now', 'next', 'second', 'third', 'finally', 'however', 'because', 'example', 'remember', 'important']);
  let cut = -1;
  for (let i = 12; i < words.length - 6; i++) {
    if (marks.has(words[i].replace(/[^a-z]/g, ''))) { cut = i; break; }
  }
  if (cut < 0) cut = Math.floor(words.length / 2);
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}
function shortTitle(s, n) {
  const w = String(s).replace(/^[A-Z][a-z]*,\s*/, '').split(/\s+/);
  return w.length <= n ? w.join(' ') : w.slice(0, n).join(' ') + '…';
}
function titleCase(s) { return String(s).split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' '); }
function trimBody(s, max) {
  const w = String(s).split(/\s+/);
  const t = w.length <= max ? String(s).trim() : w.slice(0, max).join(' ').replace(/[,;:]+$/, '') + '…';
  return t.replace(/^[a-z]/, c => c.toUpperCase());
}
function buildFromTranscript(title, segs) {
  const sorted = [...(segs || [])].sort((a, b) => a.t - b.t);
  const transcript = [];
  // 1) clean + drop exact duplicates (caption/ASR overlap), flag noise
  let prevRaw = '';
  const paras = [];
  let cur = null;
  for (const s of sorted) {
    const raw = String(s.text || '').trim();
    if (!raw || raw === prevRaw) continue;
    prevRaw = raw;
    if (RX.nonspeech.test(raw) && cleanText(raw).length < 4) {
      transcript.push({ t: s.t, text: raw, noise: true, tag: 'non-speech' });
      continue;
    }
    const text = cleanText(raw);
    if (!text || wordsOf(text).length < 2) continue;
    if (RX.noise.test(text)) {
      transcript.push({ t: s.t, text, noise: true, tag: 'announcement' });
      continue;
    }
    if (!cur || s.t - cur.lastT > 18 || cur.words > 90) {
      cur = { t0: s.t, lastT: s.t, words: 0, items: [] };
      paras.push(cur);
    }
    const w = text.split(/\s+/).length;
    cur.items.push({ t: s.t, text });
    cur.words += w; cur.lastT = s.t;
  }
  // 2) paragraphs -> timestamped sentences
  let sentences = [];
  for (const p of paras) {
    const full = p.items.map(i => i.text).join(' ');
    let chunks = splitSents(full);
    if (chunks.length === 1 && p.items.length > 1) {
      chunks = [];
      for (const it of p.items) {
        const ws = it.text.split(/\s+/);
        const hs = hardSplit(ws, 24);
        chunks.push(...hs);
      }
    }
    let used = 0;
    const total = full.split(/\s+/).length || 1;
    const span = Math.max(2, p.lastT - p.t0 + 2);
    for (const c of chunks) {
      const cw = c.split(/\s+/).length;
      const t = Math.round(p.t0 + (used / total) * span);
      used += cw;
      if (cw >= 3) sentences.push({ t, text: c });
    }
  }
  // 3) drop near-duplicate sentences (ASR/caption repeats)
  const seen6 = new Set();
  sentences = sentences.filter(s => {
    const w = wordsOf(s.text);
    if (w.length < 6) return true;
    let fresh = 0, total = 0;
    for (let i = 0; i + 6 <= w.length; i += 3) {
      total++;
      const g = w.slice(i, i + 6).join(' ');
      if (!seen6.has(g)) { fresh++; seen6.add(g); }
    }
    if (total && fresh / total < 0.35) {
      transcript.push({ t: s.t, text: s.text, noise: true, tag: 'repetition' });
      return false;
    }
    return true;
  });
  if (!sentences.length) {
    return { title, id: 'lec_' + Date.now(), transcript, notes: [], cards: [{ q: 'Nothing usable captured', a: 'The audio had no clear speech. Try a louder source or Whisper upload.', src: '' }], graph: { nodes: [{ id: 'root', label: String(title).slice(0, 18) || 'Lecture', x: 360, y: 190 }], edges: [] } };
  }
  // 4) key terms + scoring + classification
  const freq = {};
  sentences.forEach(s => contentWords(s.text).forEach(w => { freq[w] = (freq[w] || 0) + 1; }));
  const capFreq = {};
  sentences.forEach(s => {
    const m = s.text.match(RX.capPhrase) || [];
    m.forEach(p => { if (!/^(I|The|This|That|These|Those|It|We|You|And|But|For|With)$/.test(p)) capFreq[p] = (capFreq[p] || 0) + 1; });
  });
  const wgt = w => 1 + Math.log(freq[w] || 1);
  sentences.forEach((s, idx) => {
    const terms = [...new Set(contentWords(s.text))];
    let score = Math.min(12, terms.reduce((a, w) => a + ((freq[w] || 0) >= 2 ? wgt(w) : 0.4), 0));
    const named = s.text.match(RX.namedTerm);
    if (named) {
      const ct = cleanTerm(named[1]);
      if (ct.length >= 3) { s.term = ct; score += 4; }
    }
    if (!s.term) {
      const cands = [];
      for (const p of Object.keys(capFreq)) {
        const need = p.includes(' ') ? 2 : 3;
        if (capFreq[p] < need || p.split(' ').some(w => COMMON_START.has(w))) continue;
        const re = new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
        let m;
        while ((m = re.exec(s.text))) {
          if (m.index > 0) { cands.push(p); break; }
        }
      }
      if (cands.length) { s.term = cands.sort((a, b) => capFreq[b] - capFreq[a])[0]; score += 3; }
    }
    if (RX.meta.test(s.text)) score -= 6;
    if (/^(and|but|so|or|then|also)\b/i.test(s.text) && s.text.split(/\s+/).length < 15) score -= 4;
    if (/\bi (personally )?(find|think|feel|believe|love|like)\b/i.test(s.text)) score -= 3;
    if (/\?\s*$/.test(s.text)) score -= 4;
    if (RX.def.test(s.text)) { s.kind = 'definition'; score += 8; }
    else if (RX.evidence.test(s.text)) { s.kind = 'evidence'; score += 4; }
    else if (RX.cause.test(s.text)) { s.kind = 'cause'; score += 4; }
    else if (RX.example.test(s.text)) { s.kind = 'application'; score += 2; }
    else s.kind = 'key';
    if (RX.important.test(s.text)) score += 6;
    if (idx < 3) score += 1;
    const n = s.text.split(/\s+/).length;
    if (n < 8) score -= 4;
    if (n > 55) score -= 2;
    s.score = score; s.terms = terms;
  });
  // 5) topic clusters in time order
  const topics = [];
  let curT = null;
  sentences.forEach(s => {
    const bag = new Set((curT ? curT.bag : []));
    const overlap = s.terms.filter(w => bag.has(w)).length;
    const gap = curT ? s.t - curT.lastT : 0;
    if (!curT || RX.transition.test(s.text) || (gap > 40 && overlap < 2) || curT.items.length >= 14) {
      curT = { items: [], bag: [], lastT: s.t, t0: s.t };
      topics.push(curT);
    }
    curT.items.push(s); curT.lastT = s.t;
    s.terms.forEach(w => { if ((freq[w] || 0) >= 2) curT.bag.push(w); });
  });
  while (topics.length > 7) {
    let mi = 1;
    for (let i = 1; i < topics.length; i++) if (topics[i].items.length < topics[mi].items.length) mi = i;
    const victim = topics.splice(mi, 1)[0];
    topics[mi - 1].items.push(...victim.items);
  }
  topics.forEach((t, i) => {
    const tf = {};
    t.items.forEach(s => s.terms.forEach(w => { tf[w] = (tf[w] || 0) + 1; }));
    const top = [];
    for (const w of Object.keys(tf).sort((a, b) => tf[b] - tf[a])) {
      if (top.length >= 2) break;
      if (top.some(u => stemKey(u) === stemKey(w))) continue;
      top.push(w);
    }
    t.label = top.length ? titleCase(top.join(' ')) : 'Part ' + (i + 1);
    t.items.sort((a, b) => b.score - a.score);
  });
  // 6) notes: per-topic candidates, then global top picks in time order
  const cand = [];
  const usedBody = new Set();
  topics.forEach(t => {
    let coreN = 0, supN = 0;
    t.items.forEach(s => {
      if (usedBody.has(s.text)) return;
      const isCore = s.score >= 4 && coreN < 2;
      const isSup = !isCore && s.score >= 1.5 && supN < 1;
      if (!isCore && !isSup) return;
      if (isCore) coreN++; else supN++;
      let body = s.text;
      if (body.split(/\s+/).length < 12) {
        const nxt = t.items.find(x => !usedBody.has(x.text) && x.text !== s.text && Math.abs(x.t - s.t) < 40 && x.score > 0);
        if (nxt) {
          body = body.replace(/[,;:]+$/, '');
          if (!/[.?!]$/.test(body)) body += '.';
          body += ' ' + nxt.text.charAt(0).toUpperCase() + nxt.text.slice(1);
          usedBody.add(nxt.text);
        }
      }
      let label;
      if (s.kind === 'definition') label = (s.term ? titleCase(s.term) : t.label) + ' — definition';
      else if (s.kind === 'evidence') label = 'Evidence: ' + shortTitle(leadStrip(s.text), 7);
      else if (s.kind === 'cause') label = 'Why: ' + shortTitle(leadStrip(s.text), 7);
      else if (s.kind === 'application') label = 'Example: ' + shortTitle(leadStrip(s.text), 7);
      else label = t.label + ': ' + shortTitle(leadStrip(s.text), 6);
      usedBody.add(s.text);
      cand.push({ s, title: label, ts: s.t, level: isCore ? 'core' : 'supporting', kind: s.kind, body: trimBody(body, 45), topic: t.label, term: s.term || '' });
    });
  });
  cand.sort((a, b) => b.s.score - a.s.score);
  const picked = cand.slice(0, 14);
  picked.forEach(n => { n.s.used = n.level === 'core' ? 'core' : 'sup'; });
  const pickedSet = new Set(picked.map(n => n.s));
  const notes = picked.map(({ s, ...n }) => n).sort((a, b) => a.ts - b.ts);
  // transcript rows (sentences in time order; core flagged)
  const byText = {};
  sentences.forEach(s => { byText[s.text] = s; });
  sentences.sort((a, b) => a.t - b.t).forEach(s => {
    transcript.push({ t: s.t, text: s.text, core: s.used === 'core' });
  });
  transcript.sort((a, b) => a.t - b.t);
  // 7) flashcards: lecturer's own Q&A pairs first, then kind-based cards
  const cards = [];
  const usedQ = new Set();
  const usedAns = new Set();
  topics.forEach(t => {
    if (cards.length >= 3) return;
    const byTime = [...t.items].sort((a, b) => a.t - b.t);
    byTime.forEach((s, i) => {
      if (cards.length >= 3 || !/\?\s*$/.test(s.text)) return;
      const w = s.text.split(/\s+/).length;
      if (w < 5 || w > 30) return;
      const ans = byTime.slice(i + 1).find(x => !/\?\s*$/.test(x.text) && x.text.split(/\s+/).length >= 6 && !usedAns.has(x.text));
      if (!ans || usedQ.has(s.text)) return;
      usedQ.add(s.text); usedAns.add(ans.text);
      cards.push({ q: s.text.trim(), a: trimBody(ans.text, 40), src: fmt(s.t) + ' · ' + t.label });
    });
  });
  const qVar = {
    application: ['How is this applied? Give an example.', 'What is another application mentioned?', 'What use-case is described here?'],
    evidence: ['What evidence supports this?', 'What further evidence is given?'],
    cause: ['What is the cause–effect link?', 'What consequence is described?'],
    key: ['What is the key point?'],
  };
  const qCount = {};
  const cardSrc = notes.filter(n => n.level === 'core').concat(notes.filter(n => n.kind === 'evidence' && n.level !== 'core'));
  for (const n of cardSrc) {
    if (cards.length >= 8) break;
    let q, a = n.body;
    let term = n.term || '';
    if (term.length < 4 || term.split(' ').some(w => COMMON_START.has(w))) term = n.topic;
    if (n.kind === 'definition') { q = 'What is ' + term + '?'; }
    else if (n.kind === 'cause') {
      const m = n.body.match(/^(.*?)\s+because\s+(.*)$/i);
      const why = m ? leadStrip(m[1]).replace(/[.?!;,]+$/, '') : '';
      if (m && why.split(/\s+/).length <= 14 && why.split(/\s+/).length >= 3) {
        q = 'Why ' + why.charAt(0).toLowerCase() + why.slice(1) + '?'; a = 'Because ' + m[2];
      } else q = 'What is the cause–effect link?';
    }
    else if (n.kind === 'evidence') q = 'What evidence supports this?';
    else if (n.kind === 'application') q = 'How is this applied? Give an example.';
    else q = 'What is the key point about ' + n.topic + '?';
    const group = n.kind === 'definition' || n.kind === 'key' ? null : n.kind;
    if (group) {
      const vs = qVar[group];
      const k = (qCount[group] = (qCount[group] || 0) + 1) - 1;
      q = vs[k % vs.length];
    }
    if (usedQ.has(q)) continue;
    usedQ.add(q);
    cards.push({ q, a, src: fmt(n.ts) + ' · ' + n.topic });
  }
  if (!cards.length && notes.length) cards.push({ q: 'What is the key point about ' + notes[0].topic + '?', a: notes[0].body, src: fmt(notes[0].ts) });
  if (!cards.length) cards.push({ q: 'No clear points found', a: 'The speech had no standout statements. Try a longer section.', src: '' });
  // 8) concept map from topics that produced notes
  const liveTopics = topics.filter(t => pickedSet.has(t.items.find(s => pickedSet.has(s)) || {}));
  const mapped = (liveTopics.length ? liveTopics : topics.slice(0, 5)).slice(0, 8);
  const labels = mapped.map(t => t.label);
  const perRow = 5;
  const nodes = [{ id: 'root', label: fitLabel(title, 18) || 'Lecture', x: 360, y: 50 }];
  labels.forEach((l, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const n = Math.min(perRow, labels.length - row * perRow);
    nodes.push({ id: 'n' + i, label: fitLabel(l, 16), x: Math.round(360 + (col - (n - 1) / 2) * 130), y: row === 0 ? 190 : 310 });
  });
  const edges = labels.map((_, i) => ({ a: 'root', b: 'n' + i, label: 'covers' }));
  for (let i = 0; i + 1 < labels.length; i++) {
    const hasCause = mapped[i].items.some(s => s.kind === 'cause') || mapped[i + 1].items.some(s => s.kind === 'cause');
    edges.push({ a: 'n' + i, b: 'n' + (i + 1), label: hasCause ? 'leads to' : 'then' });
  }
  return { title, id: 'lec_' + Date.now(), transcript, notes, cards, graph: { nodes, edges } };
}
$('buildFromLiveBtn').onclick = () => {
  if (!liveSegs.length) return alert('No transcript yet — Start Live Transcription + play video first (or Load Demo).');
  state.data = buildFromTranscript($('lectureTitle').value || 'Live lecture', liveSegs);
  state.cardIdx = 0; state.known = new Set();
  renderAll(); renderTerms(); renderChat();
  go('transcript');
};

async function runPipeline(steps) {
  $('pipeline').classList.remove('hidden');
  const els = document.querySelectorAll('#pipeline div');
  els.forEach(d => d.classList.remove('done','busy'));
  for (const d of els) {
    d.classList.add('busy');
    await new Promise(r => setTimeout(r, 600)); // simulate AI work
    d.classList.remove('busy'); d.classList.add('done');
  }
}

async function processLecture(useDemo) {
  if (useDemo) {
    const title = $('lectureTitle').value || 'Photosynthesis - Bio 101 (Demo)';
    await runPipeline();
    ytVideoId = null; setYouTube('');
    state.data = demoData(title);
    state.data.id = 'lec_' + Date.now();
    state.cardIdx = 0; state.known = new Set();
    renderAll(); renderLibrary(); renderTerms(); renderChat();
    go('transcript');
    localStorage.setItem('echoNotes', JSON.stringify({ title }));
    return;
  }
  // REAL path — never demo data for a real link/file
  const ytUrl = ($('ytLink').value || '').trim();
  const ytId = ytUrl ? parseYtId(ytUrl) : null;
  if (ytUrl && !ytId) return alert('That YouTube link looks invalid.');
  if (ytId) {
    await runPipeline();
    setLiveStatus('Fetching YouTube captions…');
    setYouTube(ytUrl);
    liveSegs = [];
    try {
      const r = await fetch(API_BASE + '/api/youtube-transcript?url=' + encodeURIComponent(ytUrl));
      const j = await r.json();
      if (!r.ok) {
        setLiveStatus('YouTube: ' + (j.error || 'failed') + ' — playing video; use Live Transcription while it plays.');
        go('transcript'); return;
      }
      if (j.title && !$('lectureTitle').value) $('lectureTitle').value = j.title;
      const title = $('lectureTitle').value || j.title || 'YouTube lecture';
      liveSegs = j.segments || [];
      state.data = buildFromTranscript(title, liveSegs);
      state.data.id = 'lec_' + Date.now();
      state.data.source = { yt: j.videoId };
      const box = $('liveList'); if (box) { box.innerHTML = ''; liveSegs.forEach(s => { const d = document.createElement('div'); d.className = 'trow'; d.innerHTML = `<span class="ts">[${fmt(s.t)}]</span> ${s.text}`; d.querySelector('.ts').onclick = () => seekTo(s.t); box.appendChild(d); }); }
      setLiveStatus(`YouTube captions loaded: ${liveSegs.length} segments from "${title}".`);
      state.cardIdx = 0; state.known = new Set();
      renderAll(); renderLibrary(); renderTerms(); renderChat();
      go('transcript');
      return;
    } catch (e) { setLiveStatus('YouTube fetch failed (server running?): ' + e.message); go('transcript'); return; }
  }
  if (liveSegs.length) { // transcribed file/audio via Live or Whisper upload
    await runPipeline();
    ytVideoId = null; setYouTube('');
    const title = $('lectureTitle').value || $('fileInput').files[0]?.name || 'Uploaded lecture';
    state.data = buildFromTranscript(title, liveSegs);
    state.data.id = 'lec_' + Date.now();
    state.cardIdx = 0; state.known = new Set();
    renderAll(); renderLibrary(); renderTerms(); renderChat();
    go('transcript');
    return;
  }
  if ($('fileInput').files[0]) return alert('File selected but no transcript yet. Go to Transcript tab → Start Live Transcription → play the video → Stop → Build notes. (Or Upload video to server if Whisper key is set.)');
  return alert('Paste a YouTube link, or upload a file and transcribe it first. "Load Demo" is demo-only.');
}

$('processBtn').onclick = () => processLecture(false);
$('demoBtn').onclick = () => { $('lectureTitle').value = "Photosynthesis - Bio 101 (Demo)"; processLecture(true); };

function renderAll() {
  renderTranscript(); renderNotes(); renderCards(); renderGraph();
}

function renderTranscript() {
  const showNoise = $('showNoise').checked, q = ($('search').value||'').toLowerCase();
  $('transcriptList').innerHTML = '';
  state.data.transcript
    .filter(r => showNoise || !r.noise)
    .filter(r => !q || r.text.toLowerCase().includes(q))
    .forEach(r => {
      const d = document.createElement('div');
      d.className = 'trow' + (r.noise ? ' noise' : '');
      d.innerHTML = `<span class="ts" data-ts="${r.t}">[${fmt(r.t)}]</span> ${r.text}
        ${r.ref?`<small style="color:#93a0b8"> [Ref: ${r.ref}]</small>`:''}
        ${r.noise?`<span class="ntag">${r.tag} — removed</span>`:''}
        ${r.core?`<span class="ntag" style="color:#5eead4;border-color:#5eead4">central</span>`:''}`;
      d.querySelector('.ts').onclick = e => seekTo(+e.target.dataset.ts);
      $('transcriptList').appendChild(d);
    });
}
$('showNoise').onchange = renderTranscript;
$('search').oninput = () => { if(state.data){ renderTranscript(); renderNotes(); } };

function renderNotes() {
  const q = ($('search').value||'').toLowerCase();
  $('notesList').innerHTML = '';
  state.data.notes
    .filter(n => !q || (n.title+n.body).toLowerCase().includes(q))
    .forEach(n => {
      const d = document.createElement('div');
      d.className = 'note ' + (n.level==='core'?'core':'sup');
      d.innerHTML = `<h3>${n.title}
        <a href="#" data-ts="${n.ts}">[${fmt(n.ts)} ▶]</a>
        <span class="badge ${n.level==='core'?'coreB':'supB'}">${n.level}</span>
        <span class="badge ${n.kind==='definition'?'def':n.kind==='cause'?'cause':n.kind==='evidence'?'evidence':n.kind==='application'?'app':'keyB'}">${n.kind === 'key' ? 'key point' : n.kind}</span></h3>
        <div>${n.body}</div>${n.ref?`<small class="muted">Ref: ${n.ref} • term from earlier linked</small>`:''}`;
      d.querySelector('a').onclick = e => { e.preventDefault(); seekTo(+e.target.dataset.ts); if (!ytVideoId) go('upload'); };
      $('notesList').appendChild(d);
    });
}

function renderCards() {
  const c = state.data.cards; if(!c.length) return;
  $('flashcard').classList.remove('flipped');
  $('cardQ').textContent = c[state.cardIdx].q;
  $('cardA').textContent = c[state.cardIdx].a;
  $('cardSrc').textContent = c[state.cardIdx].src;
  $('cardCount').textContent = `${state.cardIdx+1}/${c.length} cards`;
  $('progress').textContent = `Known: ${state.known.size}/${c.length}`;
}
$('flipCard').onclick = () => $('flashcard').classList.toggle('flipped');
$('flashcard').onclick = () => $('flashcard').classList.toggle('flipped');
$('nextCard').onclick = () => { state.cardIdx = (state.cardIdx+1)%state.data.cards.length; renderCards(); };
$('prevCard').onclick = () => { state.cardIdx = (state.cardIdx-1+state.data.cards.length)%state.data.cards.length; renderCards(); };
$('shuffleCards').onclick = () => { state.data.cards.sort(()=>Math.random()-.5); state.cardIdx=0; renderCards(); };
$('knowBtn').onclick = () => { state.known.add(state.cardIdx); renderCards(); };

function renderGraph() {
  const svg = $('graph'); svg.innerHTML = '';
  const pos = {}; state.data.graph.nodes.forEach(n => pos[n.id]=n);
  state.data.graph.edges.forEach(e => {
    const a=pos[e.a], b=pos[e.b];
    svg.innerHTML += `<line class="gedge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
    svg.innerHTML += `<text class="gelabel" x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2-4}">${e.label}</text>`;
  });
  state.data.graph.nodes.forEach(n => {
    const g = document.createElementNS("http://www.w3.org/2000/svg","g");
    g.innerHTML = `<rect class="gnode" x="${n.x-60}" y="${n.y-18}" width="120" height="36" rx="10"/><text class="glabel" x="${n.x}" y="${n.y+4}">${n.label}</text>`;
    g.onclick = () => {
      const note = state.data.notes.find(x => x.title.toLowerCase().includes(n.label.split(' ')[0].toLowerCase()));
      $('nodeInfo').textContent = note ? `${n.label} → ${note.title} [${fmt(note.ts)}]: ${note.body}` : n.label;
    };
    svg.appendChild(g);
  });
}

$('exportTxt').onclick = () => {
  if(!state.data) return alert('Process a lecture first');
  const txt = state.data.transcript.filter(r=>!r.noise).map(r=>`[${fmt(r.t)}] ${r.text}`).join('\n');
  dl('echoNotes-transcript.txt', txt, 'text/plain');
};
$('exportMd').onclick = () => {
  if(!state.data) return alert('Process a lecture first');
  const md = `# ${state.data.title}\n\n` + state.data.notes.map(n=>`## ${n.title} [${fmt(n.ts)}]\n- level: ${n.level} | type: ${n.kind}\n- ${n.body}\n`).join('\n');
  dl('echoNotes-notes.md', md, 'text/markdown');
};
function dl(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text],{type})); a.download = name; a.click();
}

// ---- Backend API (cross-device) with localStorage fallback ----
const API_BASE = (location.protocol.startsWith('http') && location.port === '3000') ? '' : 'http://localhost:3000';
const getToken = () => localStorage.getItem('echoNotes_token');
async function api(path, opts = {}) {
  const r = await fetch(API_BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}), ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status));
  return r.json();
}
let backendOn = false;
async function checkBackend() { try { await fetch(API_BASE + '/api/me', { headers: getToken() ? { Authorization: 'Bearer ' + getToken() } : {} }); backendOn = true; } catch { backendOn = false; } }
checkBackend();
// ---- Auth: backend first, local fallback ----
const hash = s => btoa(unescape(encodeURIComponent('echo:'+s))).split('').reverse().join('');
const getUsers = () => { try { return JSON.parse(localStorage.getItem('echoNotes_users'))||{} } catch { return {} } };
const setUsers = u => localStorage.setItem('echoNotes_users', JSON.stringify(u));
const curUser = () => localStorage.getItem('echoNotes_session');
function refreshAuthUI() {
  const u = curUser();
  $('userLabel').textContent = u ? 'Logged in: '+u : 'Not logged in';
  $('logoutBtn').classList.toggle('hidden', !u);
}
$('signupBtn').onclick = async () => {
  const u=$('authUser').value.trim(), p=$('authPass').value;
  if(!u||!p) return alert('Enter username + password');
  try { const r = await api('/api/signup', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    localStorage.setItem('echoNotes_token', r.token); localStorage.setItem('echoNotes_session', r.username);
    backendOn = true; refreshAuthUI(); renderLibrary(); renderTerms(); renderChat(); return;
  } catch (e) { if (!String(e.message).includes('Failed to fetch')) return alert(e.message); }
  const users=getUsers(); if(users[u]) return alert('User exists, login instead');
  users[u]={ph:hash(p)}; setUsers(users);
  localStorage.setItem('echoNotes_session', u); refreshAuthUI(); renderLibrary(); renderTerms(); renderChat();
};
$('loginBtn').onclick = async () => {
  const u=$('authUser').value.trim(), p=$('authPass').value;
  try { const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    localStorage.setItem('echoNotes_token', r.token); localStorage.setItem('echoNotes_session', r.username);
    backendOn = true; refreshAuthUI(); renderLibrary(); renderTerms(); renderChat(); return;
  } catch (e) { if (!String(e.message).includes('Failed to fetch')) return alert(e.message); }
  const users=getUsers(); if(!users[u]||users[u].ph!==hash(p)) return alert('Invalid login (backend offline, local check failed)');
  localStorage.setItem('echoNotes_session', u); refreshAuthUI(); renderLibrary(); renderTerms(); renderChat();
};
$('logoutBtn').onclick = () => { localStorage.removeItem('echoNotes_session'); localStorage.removeItem('echoNotes_token'); refreshAuthUI(); renderLibrary(); renderTerms(); renderChat(); };

// ---- Library: save/load lectures per user ----
const libKey = () => 'echoNotes_libs_'+(curUser()||'__guest');
const getLib = () => { try { return JSON.parse(localStorage.getItem(libKey()))||[] } catch { return [] } };
const setLib = l => localStorage.setItem(libKey(), JSON.stringify(l));
$('saveLectureBtn').onclick = async () => {
  if(!curUser()) return alert('Login first to save');
  if(!state.data) return alert('Process a lecture first');
  const payload = { id: state.data.id || ('lec_'+Date.now()), title: state.data.title, data: state.data };
  state.data.id = payload.id;
  if (getToken()) {
    try { await api('/api/lectures', { method: 'POST', body: JSON.stringify(payload) }); renderLibrary(); alert('Saved to Library (server)'); return; }
    catch (e) { console.log('backend save failed, fallback local', e.message); }
  }
  const lib=getLib(); lib.unshift({id:payload.id, title:payload.title, date:new Date().toLocaleString(), data:state.data});
  setLib(lib); renderLibrary(); alert('Saved to Library (this browser only)');
};
async function renderLibrary() {
  const el=$('libraryList'); if(!el) return; el.innerHTML='';
  if(!curUser()){ el.innerHTML='<div class="muted">Login to see saved lectures.</div>'; return; }
  let lib = [];
  if (getToken()) {
    try { lib = await api('/api/lectures'); backendOn = true; }
    catch (e) { lib = getLib(); }
  } else lib = getLib();
  if(!lib.length){ el.innerHTML='<div class="muted">No saved lectures yet. Process one + Save to Library.</div>'; return; }
  lib.forEach(it => {
    const d=document.createElement('div'); d.className='trow';
    d.innerHTML=`<b>${it.title}</b> <small class="muted">${it.date||''}</small> <div class="row"><button data-a="load">Load</button><button data-a="del">Delete</button></div>`;
    d.querySelector('[data-a="load"]').onclick=()=>{ state.data=it.data; state.cardIdx=0; state.known=new Set(); renderAll(); renderTerms(); renderChat(); go('notes'); };
    d.querySelector('[data-a="del"]').onclick=async ()=>{
      if (getToken()) { try { await api('/api/lectures/'+it.id, { method: 'DELETE' }); renderLibrary(); return; } catch {} }
      setLib(getLib().filter(x=>x.id!==it.id)); renderLibrary();
    };
    el.appendChild(d);
  });
}

// ---- Terms: key glossary saved per user + lecture ----
const termKey = () => 'echoNotes_terms_'+(curUser()||'__guest');
const getTerms = () => { try { return JSON.parse(localStorage.getItem(termKey()))||[] } catch { return [] } };
const setTerms = t => localStorage.setItem(termKey(), JSON.stringify(t));
function seedTermsIfEmpty() {
  if(!state.data||curUser()&&getTerms().length) return;
  if(!curUser()) return;
  // auto-seed from notes once
  const seeds = state.data.notes.slice(0,4).map(n=>({term:n.title, def:n.body, lec:state.data.title}));
  setTerms(seeds);
}
$('addTermBtn').onclick = async () => {
  if(!curUser()) return alert('Login first');
  const t=$('termInput').value.trim(), d=$('termDef').value.trim();
  if(!t) return alert('Enter a term');
  if (getToken()) {
    try { await api('/api/terms', { method: 'POST', body: JSON.stringify({ term: t, def: d||'(no definition)', lec: state.data?.title||'general' }) });
      $('termInput').value=''; $('termDef').value=''; renderTerms(); return; } catch {}
  }
  const all=getTerms(); all.unshift({term:t, def:d||'(no definition)', lec:state.data?.title||'general'});
  setTerms(all); $('termInput').value=''; $('termDef').value=''; renderTerms();
};
async function renderTerms() {
  seedTermsIfEmpty();
  const el=$('termsList'); el.innerHTML='';
  if(!curUser()){ el.innerHTML='<div class="muted">Login to save key terms.</div>'; return; }
  let list = getTerms();
  if (getToken()) { try { list = await api('/api/terms'); } catch {} }
  list.forEach((t) => {
    const d=document.createElement('div'); d.className='trow';
    d.innerHTML=`<b>${t.term}</b> <small class="muted">${t.lec||''}</small><div>${t.def}</div><button>Remove</button>`;
    d.querySelector('button').onclick=async ()=>{
      if (getToken() && t.id) { try { await api('/api/terms/'+t.id, { method: 'DELETE' }); renderTerms(); return; } catch {} }
      const a=getTerms(); const idx=a.findIndex(x=>x.term===t.term); if(idx>=0){a.splice(idx,1); setTerms(a);} renderTerms();
    };
    el.appendChild(d);
  });
}
$('exportTerms').onclick = () => dl('echoNotes-terms.json', JSON.stringify(getTerms(),null,2), 'application/json');

// ---- Chat: ask lecture, history saved per user ----
const chatKey = () => 'echoNotes_chats_'+(curUser()||'__guest')+'_'+(state.data?.id||'nolec');
const getChat = () => { try { return JSON.parse(localStorage.getItem(chatKey()))||[] } catch { return [] } };
const setChat = c => localStorage.setItem(chatKey(), JSON.stringify(c));
function answer(q) {
  if(!state.data) return 'Process a lecture first.';
  const ql=q.toLowerCase();
  const hit = state.data.notes.find(n=>(n.title+' '+n.body).toLowerCase().split(/[^a-z]+/).some(w=>w.length>3&&ql.includes(w)))
    || state.data.transcript.find(r=>r.text.toLowerCase().split(/[^a-z]+/).some(w=>w.length>4&&ql.includes(w)));
  if(hit) return (hit.title?hit.title+': ':'') + (hit.body||hit.text) + (hit.ts!=null?` [${fmt(hit.ts)}]`:'');
  return 'Top concepts: ' + state.data.notes.map(n=>n.title).join(' | ');
}
async function renderChat() {
  const box=$('chatBox'); box.innerHTML='';
  if(!curUser()){ box.innerHTML='<div class="muted">Login to save chat history.</div>'; return; }
  let hist = getChat();
  if (getToken() && state.data?.id) { try { hist = await api('/api/chats/'+state.data.id); } catch {} }
  hist.forEach(m=>{ const d=document.createElement('div'); d.className='cmsg '+(m.who==='You'?'me':''); d.innerHTML=`<div class="who">${m.who}</div><div>${m.text}</div>`; box.appendChild(d); });
  box.scrollTop=box.scrollHeight;
}
$('chatSend').onclick = async () => {
  if(!curUser()) return alert('Login first');
  const q=$('chatInput').value.trim(); if(!q) return;
  const a=answer(q);
  if (getToken() && state.data?.id) {
    try { await api('/api/chats/'+state.data.id, { method: 'POST', body: JSON.stringify({ who: 'You', text: q }) });
      await api('/api/chats/'+state.data.id, { method: 'POST', body: JSON.stringify({ who: 'echoNotes', text: a }) });
      $('chatInput').value=''; renderChat(); return; } catch {}
  }
  const h=getChat(); h.push({who:'You', text:q}); h.push({who:'echoNotes', text:a});
  setChat(h); $('chatInput').value=''; renderChat();
};
$('chatClear').onclick = async () => {
  if (getToken() && state.data?.id) { try { await api('/api/chats/'+state.data.id, { method: 'DELETE' }); renderChat(); return; } catch {} }
  localStorage.removeItem(chatKey()); renderChat();
};

// restore last title + auth
try { const s = JSON.parse(localStorage.getItem('echoNotes')); if(s?.title) $('lectureTitle').value = s.title; } catch {}
refreshAuthUI(); renderLibrary(); renderTerms(); renderChat();
