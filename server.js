/* Loknayak – news portal + e-paper server. Pure JavaScript, no native modules. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const express = require('express'), multer = require('multer'), bcrypt = require('bcryptjs');

// ---------- .env (optional) ----------
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}

const DATA = path.join(__dirname, 'data'), UP = path.join(__dirname, 'uploads'), PUB = path.join(__dirname, 'public');
[DATA, UP].forEach(d => fs.mkdirSync(d, { recursive: true }));
const ADMIN_PHONE = '9405941894';
const CATEGORIES = ['स्थानिक', 'महाराष्ट्र', 'राजकारण', 'कृषी / ग्रामीण', 'क्रीडा', 'मनोरंजन', 'व्यापार', 'संपादकीय'];

// ---------- tiny JSON database ----------
const DB_FILE = path.join(DATA, 'db.json');
let db = { users: [], news: [], editions: [], clips: [], tips: [], voted: [], otp: null, seq: 1000,
  poll: { id: 1, active: true, question: 'तुमच्या गावातील सर्वात मोठी समस्या कोणती?', options: [{ t: 'पाणी', v: 0 }, { t: 'रस्ते', v: 0 }, { t: 'वीज', v: 0 }, { t: 'आरोग्य', v: 0 }] },
  settings: { siteName: 'लोकनायक', reviewRequired: false, whatsapp: '', facebook: '', youtube: '', instagram: '', twitter: '', oneSignalAppId: '',
    weatherCity: 'छत्रपती संभाजीनगर', weatherLat: 19.8762, weatherLon: 75.3433, editions: ['छत्रपती संभाजीनगर', 'बीड', 'जालना'] } };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
db.settings = Object.assign({ siteName: 'लोकनायक' }, db.settings);
function save() { const t = DB_FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, DB_FILE); }
const nid = () => ++db.seq;
if (!db.users.find(u => u.role === 'admin'))
  db.users.push({ id: ADMIN_PHONE, name: 'Super Admin', role: 'admin', phone: ADMIN_PHONE, hash: bcrypt.hashSync('admin123', 8), active: true, created: new Date().toISOString() });
save();

// ---------- auth (signed cookie) ----------
let SECRET; const SF = path.join(DATA, 'secret.txt');
try { SECRET = fs.readFileSync(SF, 'utf8'); } catch (e) { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SF, SECRET); }
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeToken = u => { const p = Buffer.from(JSON.stringify({ id: u.id, exp: Date.now() + 7 * 864e5 })).toString('base64url'); return p + '.' + sign(p); };
function getUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)ln=([^;]+)/); if (!m) return null;
  const [p, s] = m[1].split('.'); if (!p || s !== sign(p)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); if (d.exp < Date.now()) return null;
    const u = db.users.find(x => x.id === d.id && x.active); return u || null; } catch (e) { return null; }
}
const need = (...roles) => (req, res, next) => { const u = getUser(req); if (!u || (roles.length && !roles.includes(u.role))) return res.status(401).json({ error: 'लॉगिन आवश्यक / परवानगी नाही' }); req.user = u; next(); };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tries = {}; // simple brute-force guard
const limited = (k, max = 10, ms = 6e5) => { const n = Date.now(); tries[k] = (tries[k] || []).filter(t => n - t < ms); return tries[k].length >= max; };
const hit = k => (tries[k] = tries[k] || []).push(Date.now());
const pub = u => ({ id: u.id, name: u.name, role: u.role, phone: u.phone, active: u.active, created: u.created });
const normPhone = p => String(p || '').replace(/\D/g, '').slice(-10);

// ---------- uploads ----------
const mk = (filter, mb) => multer({ limits: { fileSize: mb * 1048576 }, fileFilter: (r, f, cb) => cb(null, filter.test(f.mimetype)),
  storage: multer.diskStorage({ destination: UP, filename: (r, f, cb) => {
    const ext = (path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin').slice(0, 6);
    cb(null, Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + ext); } }) });
const upMedia = mk(/^(image|video)\//, 150), upImg = mk(/^image\//, 15), upPdf = mk(/pdf|octet-stream/, 200);
const url = f => '/uploads/' + f.filename;
const rm = u => { if (u && u.startsWith('/uploads/')) fs.unlink(path.join(UP, path.basename(u)), () => {}); };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UP, { maxAge: '7d' }));
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = req => process.env.SITE_URL || (req.protocol + '://' + req.get('host'));

// ---------- auth routes ----------
app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip, id = String(req.body.id || '').trim();
  if (limited('l' + ip)) return res.status(429).json({ error: 'खूप प्रयत्न झाले. १० मिनिटांनी पुन्हा प्रयत्न करा.' });
  const u = db.users.find(x => x.id === id || (x.role === 'admin' && normPhone(id) === x.phone));
  if (!u || !u.active || !bcrypt.compareSync(String(req.body.password || ''), u.hash)) { hit('l' + ip); return res.status(401).json({ error: 'आयडी किंवा पासवर्ड चुकीचा आहे' }); }
  res.setHeader('Set-Cookie', `ln=${makeToken(u)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}`);
  res.json({ user: pub(u) });
}));
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'ln=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => { const u = getUser(req); res.json({ user: u ? pub(u) : null }); });
app.post('/api/password', need(), (req, res) => {
  if (!bcrypt.compareSync(String(req.body.old || ''), req.user.hash)) return res.status(400).json({ error: 'जुना पासवर्ड चुकीचा' });
  if (String(req.body.new || '').length < 6) return res.status(400).json({ error: 'नवीन पासवर्ड किमान ६ अक्षरांचा हवा' });
  req.user.hash = bcrypt.hashSync(req.body.new, 8); save(); res.json({ ok: true });
});
app.post('/api/forgot', wrap(async (req, res) => {
  if (limited('o' + req.ip, 5)) return res.status(429).json({ error: 'खूप प्रयत्न. नंतर प्रयत्न करा.' }); hit('o' + req.ip);
  if (normPhone(req.body.phone) !== ADMIN_PHONE) return res.status(403).json({ error: 'OTP फक्त अधिकृत Super Admin क्रमांकावर पाठवला जातो' });
  const otp = String(crypto.randomInt(100000, 999999));
  db.otp = { hash: bcrypt.hashSync(otp, 6), exp: Date.now() + 10 * 6e4, tries: 0 }; save();
  const key = process.env.FAST2SMS_KEY;
  if (!key) { console.log('\n==== ADMIN OTP: ' + otp + ' (10 मिनिटे वैध) — Fast2SMS key नसल्यामुळे येथे दाखवला ====\n'); return res.json({ ok: true, dev: true }); }
  const r = await fetch(`https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(key)}&route=otp&variables_values=${otp}&numbers=${ADMIN_PHONE}`);
  const j = await r.json().catch(() => ({}));
  if (!j.return) return res.status(502).json({ error: 'SMS पाठवता आला नाही: ' + (j.message || r.status) });
  res.json({ ok: true });
}));
app.post('/api/reset', (req, res) => {
  const o = db.otp;
  if (normPhone(req.body.phone) !== ADMIN_PHONE || !o || o.exp < Date.now() || o.tries > 5) return res.status(400).json({ error: 'OTP अवैध किंवा कालबाह्य' });
  o.tries++; if (!bcrypt.compareSync(String(req.body.otp || ''), o.hash)) { save(); return res.status(400).json({ error: 'OTP चुकीचा आहे' }); }
  if (String(req.body.password || '').length < 6) return res.status(400).json({ error: 'पासवर्ड किमान ६ अक्षरांचा हवा' });
  const a = db.users.find(u => u.role === 'admin'); a.hash = bcrypt.hashSync(req.body.password, 8); db.otp = null; save(); res.json({ ok: true });
});

// ---------- users (admin) ----------
app.get('/api/users', need('admin'), (req, res) => res.json(db.users.map(pub)));
app.post('/api/users', need('admin'), (req, res) => {
  const name = String(req.body.name || '').trim(); if (!name) return res.status(400).json({ error: 'नाव आवश्यक' });
  let id; do { id = 'rep' + nid(); } while (db.users.find(u => u.id === id));
  const password = req.body.password || crypto.randomBytes(4).toString('hex');
  db.users.push({ id, name, role: 'reporter', phone: normPhone(req.body.phone), hash: bcrypt.hashSync(password, 8), active: true, created: new Date().toISOString() }); save();
  res.json({ id, password, name });
});
app.put('/api/users/:id', need('admin'), (req, res) => {
  const u = db.users.find(x => x.id === req.params.id); if (!u) return res.status(404).json({ error: 'सापडले नाही' });
  if (req.body.name) u.name = String(req.body.name); if (req.body.phone !== undefined) u.phone = normPhone(req.body.phone);
  if (req.body.active !== undefined && u.role !== 'admin') u.active = !!req.body.active;
  let password; if (req.body.resetPassword) { password = crypto.randomBytes(4).toString('hex'); u.hash = bcrypt.hashSync(password, 8); }
  save(); res.json({ ok: true, password });
});
app.delete('/api/users/:id', need('admin'), (req, res) => {
  const u = db.users.find(x => x.id === req.params.id); if (!u || u.role === 'admin') return res.status(400).json({ error: 'हटवता येत नाही' });
  db.users = db.users.filter(x => x !== u); save(); res.json({ ok: true });
});

// ---------- settings ----------
app.get('/api/config', (req, res) => res.json({ categories: CATEGORIES, settings: db.settings }));
app.put('/api/settings', need('admin'), (req, res) => {
  for (const k of Object.keys(db.settings)) if (req.body[k] !== undefined) db.settings[k] = typeof db.settings[k] === 'boolean' ? !!req.body[k] : typeof db.settings[k] === 'number' ? Number(req.body[k]) : req.body[k];
  save(); res.json(db.settings);
});

// ---------- AI enhance ----------
const SYS = `तुम्ही एका प्रतिष्ठित मराठी दैनिकाचे अनुभवी उपसंपादक आहात. दिलेल्या खडबडीत मजकुराचे प्रमाण मराठी पत्रकारितेच्या शैलीत शुद्धलेखन व व्याकरण सुधारून रूपांतर करा. नवीन तथ्ये, नावे, आकडे किंवा अवतरणे अजिबात घालू नका. परिच्छेद छोटे (२-४ वाक्ये) ठेवा आणि परिच्छेदांमध्ये रिकामी ओळ ठेवा. फक्त वैध JSON द्या, इतर काहीही नाही: {"headline":"आकर्षक मथळा (९० अक्षरांपर्यंत)","body":"सुधारित मजकूर","metaTitle":"SEO शीर्षक (६० अक्षरांपर्यंत)","metaDescription":"SEO वर्णन (१५५ अक्षरांपर्यंत)","tags":["टॅग१","टॅग२","टॅग३"]}`;
function fallbackEnhance(h, b, cat) {
  const body = String(b || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').split('\n').map(s => s.trim()).filter(Boolean).join('\n\n');
  const first = (body.split(/[।.?!\n]/)[0] || '').trim().slice(0, 90);
  const headline = h || first;
  return { headline, body, metaTitle: headline.slice(0, 60), metaDescription: body.replace(/\s+/g, ' ').slice(0, 155), tags: [cat].filter(Boolean), ai: false };
}
app.post('/api/ai/enhance', need('admin', 'reporter'), wrap(async (req, res) => {
  const { headline = '', body = '', category = '' } = req.body;
  if (!String(body).trim() && !String(headline).trim()) return res.status(400).json({ error: 'आधी मजकूर लिहा' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.json(Object.assign(fallbackEnhance(headline, body, category), { note: 'AI key सेट नाही — फक्त साधे फॉरमॅटिंग केले. .env मध्ये ANTHROPIC_API_KEY टाका.' }));
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 2500, system: SYS,
        messages: [{ role: 'user', content: `विभाग: ${category}\nमथळा (असल्यास): ${headline}\nमजकूर:\n${body}` }] }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || r.status);
    const t = (j.content || []).map(c => c.text || '').join(''); const m = t.match(/\{[\s\S]*\}/); const o = JSON.parse(m[0]);
    res.json({ headline: o.headline || headline, body: o.body || body, metaTitle: o.metaTitle || '', metaDescription: o.metaDescription || '', tags: o.tags || [], ai: true });
  } catch (e) { res.json(Object.assign(fallbackEnhance(headline, body, category), { note: 'AI त्रुटी (' + e.message + ') — साधे फॉरमॅटिंग केले.' })); }
}));

// ---------- news ----------
const ytId = s => { const m = String(s || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/); return m ? m[1] : null; };
const isToday = iso => new Date(iso) >= new Date(new Date().setHours(0, 0, 0, 0));
const card = n => ({ id: n.id, category: n.category, headline: n.headline, summary: n.metaDescription || n.body.slice(0, 140), media: n.media, author: n.author, createdAt: n.createdAt, breaking: n.breaking, featured: n.featured, views: n.views });
app.get('/api/news', (req, res) => {
  const { category, q, breaking, featured, kind } = req.query; const limit = Math.min(+req.query.limit || 40, 200);
  let l = db.news.filter(n => n.status === 'published');
  if (category) l = l.filter(n => n.category === category);
  if (breaking) l = l.filter(n => n.breaking); if (featured) l = l.filter(n => n.featured);
  if (kind === 'video') l = l.filter(n => n.media.some(m => m.type !== 'image'));
  if (kind === 'photo') l = l.filter(n => n.media.some(m => m.type === 'image'));
  if (q) l = l.filter(n => (n.headline + n.body).includes(q));
  res.json(l.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(card));
});
app.get('/api/news/:id', (req, res) => {
  const n = db.news.find(x => x.id == req.params.id); const u = getUser(req);
  if (!n || (n.status !== 'published' && !(u && (u.role === 'admin' || u.id === n.authorId)))) return res.status(404).json({ error: 'बातमी सापडली नाही' });
  if (n.status === 'published') { n.views++; if (n.views % 10 === 0) save(); }
  res.json(Object.assign({}, n, { related: db.news.filter(x => x.status === 'published' && x.category === n.category && x.id !== n.id).slice(-4).reverse().map(card) }));
});
app.get('/api/admin/news', need('admin', 'reporter'), (req, res) => {
  let l = db.news.filter(n => req.user.role === 'admin' || n.authorId === req.user.id);
  if (req.query.status) l = l.filter(n => n.status === req.query.status);
  res.json(l.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300).map(n => Object.assign(card(n), { status: n.status, authorId: n.authorId })));
});
app.post('/api/news', need('admin', 'reporter'), upMedia.array('media', 8), (req, res) => {
  const b = req.body; const body = String(b.body || '').trim();
  if (!body && !(req.files || []).length && !b.youtube) return res.status(400).json({ error: 'मजकूर किंवा मीडिया आवश्यक' });
  const media = (req.files || []).map(f => ({ type: f.mimetype.startsWith('video') ? 'video' : 'image', url: url(f) }));
  const y = ytId(b.youtube); if (y) media.push({ type: 'youtube', id: y });
  let headline = String(b.headline || '').trim() || body.split(/[।.?!\n]/)[0].trim().slice(0, 90) || 'बातमी';
  const needsReview = req.user.role === 'reporter' && db.settings.reviewRequired;
  const n = { id: nid(), category: CATEGORIES.includes(b.category) ? b.category : CATEGORIES[0], headline, body,
    metaTitle: String(b.metaTitle || headline).slice(0, 70), metaDescription: String(b.metaDescription || body.replace(/\s+/g, ' ').slice(0, 155)),
    tags: String(b.tags || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8), media, author: req.user.name, authorId: req.user.id,
    status: needsReview ? 'pending' : 'published', breaking: false, featured: false, views: 0, createdAt: new Date().toISOString() };
  db.news.push(n); save(); res.json({ id: n.id, status: n.status });
});
app.put('/api/news/:id', need('admin', 'reporter'), (req, res) => {
  const n = db.news.find(x => x.id == req.params.id); if (!n) return res.status(404).json({ error: 'सापडले नाही' });
  const admin = req.user.role === 'admin'; if (!admin && n.authorId !== req.user.id) return res.status(403).json({ error: 'परवानगी नाही' });
  const f = ['headline', 'body', 'category', 'metaTitle', 'metaDescription']; f.forEach(k => { if (req.body[k] !== undefined) n[k] = String(req.body[k]); });
  if (admin) { ['status'].forEach(k => { if (['published', 'pending', 'unpublished'].includes(req.body[k])) n[k] = req.body[k]; });
    ['breaking', 'featured'].forEach(k => { if (req.body[k] !== undefined) n[k] = !!req.body[k]; }); }
  save(); res.json({ ok: true });
});
app.delete('/api/news/:id', need('admin'), (req, res) => {
  const n = db.news.find(x => x.id == req.params.id); if (!n) return res.json({ ok: true });
  n.media.forEach(m => rm(m.url)); db.news = db.news.filter(x => x !== n); save(); res.json({ ok: true });
});
app.get('/api/stats', need('admin'), (req, res) => {
  const t = db.news.filter(n => isToday(n.createdAt)); const per = {};
  t.forEach(n => { const p = per[n.authorId] = per[n.authorId] || { name: n.author, posts: 0, photos: 0 }; p.posts++; p.photos += n.media.filter(m => m.type === 'image').length; });
  res.json({ published: t.filter(n => n.status === 'published').length, pending: db.news.filter(n => n.status === 'pending').length,
    photos: t.reduce((a, n) => a + n.media.filter(m => m.type === 'image').length, 0), tips: db.tips.length, total: db.news.length, perReporter: Object.values(per) });
});

// ---------- e-paper ----------
const visible = e => e.status === 'published' || (e.status === 'scheduled' && new Date(e.publishAt) <= new Date());
const edSummary = e => ({ id: e.id, title: e.title, alias: e.alias, date: e.date, edition: e.edition, description: e.description, status: e.status, publishAt: e.publishAt, pdf: e.pdf, pageCount: e.pages.length, cover: e.pages[0] && (e.pages[0].thumb || e.pages[0].img) });
app.get('/api/editions', (req, res) => {
  const u = getUser(req), all = u && u.role === 'admin';
  res.json(db.editions.filter(e => all || visible(e)).slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).map(edSummary));
});
app.get('/api/editions/:id', (req, res) => {
  const u = getUser(req); const e = db.editions.find(x => x.id == req.params.id || x.alias === req.params.id);
  if (!e || !(visible(e) || (u && u.role === 'admin'))) return res.status(404).json({ error: 'आवृत्ती सापडली नाही' });
  res.json(Object.assign(edSummary(e), { pages: e.pages.slice().sort((a, b) => a.n - b.n) }));
});
const slug = s => String(s || '').trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
app.post('/api/editions', need('admin'), (req, res) => {
  const b = req.body; if (!String(b.title || '').trim()) return res.status(400).json({ error: 'Edition Title आवश्यक' });
  let alias = slug(b.alias || b.title) || 'edition'; while (db.editions.find(e => e.alias === alias)) alias += '-' + nid();
  const status = ['published', 'draft', 'scheduled'].includes(b.status) ? b.status : 'published';
  const e = { id: nid(), title: b.title.trim(), alias, description: b.description || '', date: b.date || new Date().toISOString().slice(0, 10), edition: b.edition || db.settings.editions[0],
    status, publishAt: b.publishAt || null, pdf: null, pages: [], createdAt: new Date().toISOString() };
  db.editions.push(e); save(); res.json(edSummary(e));
});
app.put('/api/editions/:id', need('admin'), (req, res) => {
  const e = db.editions.find(x => x.id == req.params.id); if (!e) return res.status(404).json({ error: 'सापडले नाही' });
  ['title', 'description', 'date', 'edition', 'publishAt'].forEach(k => { if (req.body[k] !== undefined) e[k] = req.body[k]; });
  if (['published', 'draft', 'scheduled'].includes(req.body.status)) e.status = req.body.status; save(); res.json(edSummary(e));
});
app.delete('/api/editions/:id', need('admin'), (req, res) => {
  const e = db.editions.find(x => x.id == req.params.id); if (!e) return res.json({ ok: true });
  rm(e.pdf); e.pages.forEach(p => { rm(p.img); rm(p.thumb); }); db.editions = db.editions.filter(x => x !== e); save(); res.json({ ok: true });
});
app.post('/api/editions/:id/pdf', need('admin'), upPdf.single('pdf'), (req, res) => {
  const e = db.editions.find(x => x.id == req.params.id); if (!e || !req.file) return res.status(400).json({ error: 'PDF मिळाला नाही' });
  rm(e.pdf); e.pdf = url(req.file); save(); res.json({ pdf: e.pdf });
});
app.post('/api/editions/:id/pages', need('admin'), upImg.fields([{ name: 'img', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
  const e = db.editions.find(x => x.id == req.params.id), n = parseInt(req.body.n);
  if (!e || !n || !req.files || !req.files.img) return res.status(400).json({ error: 'पेज इमेज मिळाली नाही' });
  const old = e.pages.find(p => p.n === n); const areas = old ? old.areas : [];
  if (old) { rm(old.img); rm(old.thumb); e.pages = e.pages.filter(p => p !== old); }
  e.pages.push({ n, img: url(req.files.img[0]), thumb: req.files.thumb ? url(req.files.thumb[0]) : null, areas }); save(); res.json({ ok: true, n });
});
app.delete('/api/editions/:id/pages/:n', need('admin'), (req, res) => {
  const e = db.editions.find(x => x.id == req.params.id); if (!e) return res.json({ ok: true });
  const p = e.pages.find(x => x.n == req.params.n); if (p) { rm(p.img); rm(p.thumb); e.pages = e.pages.filter(x => x !== p); save(); } res.json({ ok: true });
});
app.put('/api/editions/:id/pages/:n/areas', need('admin'), (req, res) => {
  const e = db.editions.find(x => x.id == req.params.id), p = e && e.pages.find(x => x.n == req.params.n); if (!p) return res.status(404).json({ error: 'पेज सापडले नाही' });
  const c = v => Math.max(0, Math.min(100, +v || 0));
  p.areas = (Array.isArray(req.body.areas) ? req.body.areas : []).map((a, i) => ({ id: i + 1, x: c(a.x), y: c(a.y), w: c(a.w), h: c(a.h), title: String(a.title || '').slice(0, 150) })).filter(a => a.w > 0.5 && a.h > 0.5);
  save(); res.json({ ok: true, count: p.areas.length });
});

// ---------- shareable clips (for WhatsApp / Facebook previews) ----------
app.post('/api/clips', upImg.single('img'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'इमेज नाही' });
  if (limited('c' + req.ip, 40, 36e5)) { rm(url(req.file)); return res.status(429).json({ error: 'खूप क्लिप्स. नंतर प्रयत्न करा.' }); } hit('c' + req.ip);
  const c = { id: nid().toString(36) + crypto.randomBytes(3).toString('hex'), img: url(req.file), title: String(req.body.title || '').slice(0, 150), edition: req.body.edition || '', page: req.body.page || '', created: new Date().toISOString() };
  db.clips.push(c); if (db.clips.length > 3000) { rm(db.clips.shift().img); } save(); res.json({ id: c.id, url: '/clip/' + c.id, img: c.img });
});
const page = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const og = (t, d, img, u) => `<title>${esc(t)}</title><meta name="description" content="${esc(d)}"><meta property="og:type" content="article"><meta property="og:site_name" content="${esc(db.settings.siteName)}"><meta property="og:title" content="${esc(t)}"><meta property="og:description" content="${esc(d)}"><meta property="og:url" content="${esc(u)}">${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">` : ''}`;
app.get('/clip/:id', (req, res) => {
  const c = db.clips.find(x => x.id === req.params.id); if (!c) return res.status(404).send('Clip not found');
  const t = (c.title || 'ई-पेपर क्लिप') + ' | ' + db.settings.siteName;
  res.send(`<!doctype html><html lang="mr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${og(t, c.edition + ' – पान ' + c.page, base(req) + c.img, base(req) + req.originalUrl)}<style>body{margin:0;background:#f2f4f7;font-family:sans-serif;text-align:center}img{max-width:100%;box-shadow:0 4px 18px #0003;margin:16px 0}a{display:inline-block;background:#e31e24;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;margin:8px}</style></head><body><img src="${esc(c.img)}" alt=""><br><a href="/epaper.html">आजची ई-पेपर</a><a href="/">मुख्यपृष्ठ</a></body></html>`);
});
app.get(['/article/:id', '/article.html'], (req, res) => {
  const id = req.params.id || req.query.id; const n = db.news.find(x => x.id == id && x.status === 'published');
  let h = page('article.html'); if (!n) return res.send(h.replace('<!--OG-->', '<title>लोकनायक</title>'));
  const im = n.media.find(m => m.type === 'image'); const img = im ? base(req) + im.url : n.media.find(m => m.type === 'youtube') ? `https://i.ytimg.com/vi/${n.media.find(m => m.type === 'youtube').id}/hqdefault.jpg` : base(req) + '/img/logo-banner.jpg';
  res.send(h.replace('<!--OG-->', og(n.metaTitle || n.headline, n.metaDescription, img, base(req) + '/article/' + n.id)));
});

// ---------- poll, citizen tips ----------
app.get('/api/poll', (req, res) => res.json(db.poll));
app.post('/api/poll/vote', (req, res) => {
  const i = parseInt(req.body.option), k = crypto.createHash('sha1').update(req.ip + db.poll.id).digest('hex');
  if (!db.poll.active || !db.poll.options[i]) return res.status(400).json({ error: 'अवैध' });
  if (db.voted.includes(k)) return res.json(Object.assign({ already: true }, db.poll));
  db.voted.push(k); db.poll.options[i].v++; save(); res.json(db.poll);
});
app.put('/api/poll', need('admin'), (req, res) => {
  const o = (req.body.options || []).map(s => String(s).trim()).filter(Boolean).slice(0, 6);
  if (!req.body.question || o.length < 2) return res.status(400).json({ error: 'प्रश्न व किमान २ पर्याय हवेत' });
  db.poll = { id: db.poll.id + 1, active: true, question: req.body.question, options: o.map(t => ({ t, v: 0 })) }; db.voted = []; save(); res.json(db.poll);
});
app.post('/api/tips', upImg.single('photo'), (req, res) => {
  const b = req.body; if (!String(b.text || '').trim()) { if (req.file) rm(url(req.file)); return res.status(400).json({ error: 'माहिती लिहा' }); }
  if (limited('t' + req.ip, 8, 36e5)) return res.status(429).json({ error: 'खूप सबमिशन्स. नंतर प्रयत्न करा.' }); hit('t' + req.ip);
  db.tips.push({ id: nid(), name: String(b.name || '').slice(0, 80), phone: String(b.phone || '').slice(0, 20), place: String(b.place || '').slice(0, 80), text: String(b.text).slice(0, 4000), photo: req.file ? url(req.file) : null, created: new Date().toISOString() });
  save(); res.json({ ok: true });
});
app.get('/api/tips', need('admin'), (req, res) => res.json(db.tips.slice().reverse()));
app.delete('/api/tips/:id', need('admin'), (req, res) => { const t = db.tips.find(x => x.id == req.params.id); if (t) { rm(t.photo); db.tips = db.tips.filter(x => x !== t); save(); } res.json({ ok: true }); });
app.post('/api/tips/:id/publish', need('admin'), (req, res) => {
  const t = db.tips.find(x => x.id == req.params.id); if (!t) return res.status(404).json({ error: 'सापडले नाही' });
  const h = t.text.split(/[।.?!\n]/)[0].slice(0, 90);
  db.news.push({ id: nid(), category: 'स्थानिक', headline: h, body: t.text + (t.name ? `\n\n(नागरिक पत्रकार: ${t.name}${t.place ? ', ' + t.place : ''})` : ''), metaTitle: h, metaDescription: t.text.slice(0, 155), tags: ['नागरिक पत्रकार'],
    media: t.photo ? [{ type: 'image', url: t.photo }] : [], author: 'नागरिक पत्रकार', authorId: 'citizen', status: 'pending', breaking: false, featured: false, views: 0, createdAt: new Date().toISOString() });
  db.tips = db.tips.filter(x => x !== t); save(); res.json({ ok: true });
});

// ---------- static + errors ----------
app.use(express.static(PUB, { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => req.path.startsWith('/api/') ? res.status(404).json({ error: 'सापडले नाही' }) : res.status(404).send('Not found'));
app.use((err, req, res, next) => { console.error(err); res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'फाइल खूप मोठी आहे' : 'सर्व्हर त्रुटी: ' + err.message }); });

let port = +process.env.PORT || 3000;
(function start(n) {
  const s = app.listen(port, () => console.log(`\n  लोकनायक चालू आहे ✔\n  वेबसाइट : http://localhost:${port}\n  लॉगिन   : http://localhost:${port}/panel.html   (ID: ${ADMIN_PHONE}  Password: admin123)\n`));
  s.on('error', e => { if (e.code === 'EADDRINUSE' && n < 10) { port++; start(n + 1); } else { console.error(e); process.exit(1); } });
})(0);
