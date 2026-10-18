// Agricultural Marketplace - backend. Saves every record into data/marketplace.xlsx (Excel).
// Optional: set "storage": "google" in config.json to use Google Sheets instead.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Google Sheets connection (config.json or environment variables) ----
let CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) { /* optional */ }
const SCRIPT_URL = process.env.SHEETS_URL || CONFIG.scriptUrl;
const SECRET = process.env.SHEETS_SECRET || CONFIG.secret;
const MODE = (process.env.STORAGE || CONFIG.storage || 'excel').toLowerCase();
// The Excel file lives OUTSIDE the project folder, so replacing/unzipping a new version never wipes your records.
const DIR = process.env.DATA_DIR || path.join(require('os').homedir(), 'Khet2Ghar-data');
const FILE = path.join(DIR, 'marketplace.xlsx');
const ExcelJS = MODE === 'excel' ? require('exceljs') : null;
if (MODE === 'google' && (!SCRIPT_URL || SCRIPT_URL.startsWith('PASTE_'))) {
  console.error('\nGoogle Sheets is not connected yet.\nPaste your Web App URL into "scriptUrl" in config.json, or set "storage": "excel".\n');
  process.exit(1);
}

const SHEETS = {
  Farmers: ['ID', 'Full Name', 'Phone', 'Address', 'Bank / UPI', 'Registered On', 'Username', 'Password Hash'],
  Buyers:  ['ID', 'Full Name / Company', 'Phone', 'Delivery Address', 'GSTIN', 'Payment Method', 'Registered On', 'Username', 'Password Hash'],
  Crops:   ['ID', 'Farmer ID', 'Farmer Name', 'Crop', 'Category', 'Price (Rs/kg)', 'Quantity (kg)', 'Location', 'Listed On'],
  Orders:  ['ID', 'Buyer ID', 'Buyer Name', 'Crop ID', 'Crop', 'Farmer ID', 'Quantity (kg)', 'Total (Rs)', 'Payment', 'Status', 'Ordered On']
};

async function gs(body) {
  let res;
  try {
    res = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: SECRET, ...body }), redirect: 'follow' });
  } catch (e) { throw new Error('Cannot reach Google Sheets. Check your internet connection.'); }
  let json;
  try { json = JSON.parse(await res.text()); }
  catch (e) { throw new Error('Google Sheets gave an unexpected reply. Re-deploy the Apps Script with access set to "Anyone" and check scriptUrl in config.json.'); }
  if (!json.ok) throw new Error('Google Sheets: ' + json.message);
  return json;
}

// A tiny in-memory copy of the sheet. Changes are collected and sent to Google in one call.
class Row {
  constructor(sheet, n, vals, isNew = false) { this.sheet = sheet; this.n = n; this.vals = vals; this.isNew = isNew; }
  getCell(i) {
    const row = this;
    return {
      get value() { return row.vals[i - 1]; },
      set value(v) { row.vals[i - 1] = v; if (!row.isNew) row.sheet.updates.push({ row: row.n, col: i, value: v }); }
    };
  }
}
class Sheet {
  constructor(name, grid) { this.name = name; this.list = grid.map((v, i) => new Row(this, i + 1, v)); this.appends = []; this.updates = []; }
  get rowCount() { return this.list.length; }
  eachRow(cb) { this.list.forEach((r) => cb(r, r.n)); }
  addRow(vals) { const r = new Row(this, this.list.length + 1, vals.slice(), true); this.list.push(r); this.appends.push(r); return r; }
}

async function loadExcel() {
  fs.mkdirSync(DIR, { recursive: true });
  const xl = new ExcelJS.Workbook();
  if (fs.existsSync(FILE)) await xl.xlsx.readFile(FILE);
  const sheets = {};
  Object.entries(SHEETS).forEach(([name, cols]) => {
    const ws = xl.getWorksheet(name);
    const grid = [cols.slice()];
    if (ws) for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) continue;
      grid.push(cols.map((_, i) => { const v = row.getCell(i + 1).value; return v === null || v === undefined ? '' : (typeof v === 'object' && v.text ? v.text : v); }));
    }
    sheets[name] = new Sheet(name, grid);
  });
  return { sheets, getWorksheet(n) { return this.sheets[n]; } };
}
async function writeExcel(wb) {
  const xl = new ExcelJS.Workbook();
  Object.entries(SHEETS).forEach(([name, cols]) => {
    const ws = xl.addWorksheet(name);
    ws.columns = cols.map((h) => ({ header: h, key: h, width: Math.max(16, h.length + 4) }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5130' } };
    wb.sheets[name].list.slice(1).forEach((r) => ws.addRow(r.vals));
  });
  try { await xl.xlsx.writeFile(FILE); }
  catch (e) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw new Error('Cannot save: close data/marketplace.xlsx in Excel and try again.');
    throw e;
  }
}

let cache = null, cachedAt = 0;
async function load() {
  if (MODE === 'excel') return loadExcel();
  if (cache && Date.now() - cachedAt < 15000) return cache; // refresh from Google every 15 s
  const { data } = await gs({ action: 'dump', headers: SHEETS });
  const sheets = {};
  Object.keys(SHEETS).forEach((n) => (sheets[n] = new Sheet(n, data[n])));
  cache = { sheets, getWorksheet(n) { return this.sheets[n]; } };
  cachedAt = Date.now();
  return cache;
}
async function flush(wb) {
  const appends = {}, updates = [];
  Object.values(wb.sheets).forEach((ws) => {
    if (ws.appends.length) appends[ws.name] = ws.appends.map((r) => r.vals);
    ws.updates.forEach((u) => updates.push({ sheet: ws.name, ...u }));
  });
  if (!Object.keys(appends).length && !updates.length) return;
  if (MODE === 'excel') await writeExcel(wb);
  else await gs({ action: 'save', appends, updates });
  Object.values(wb.sheets).forEach((ws) => { ws.appends.forEach((r) => (r.isNew = false)); ws.appends = []; ws.updates = []; });
}

// Serialise all requests so two people saving at once never clash
let queue = Promise.resolve();
const withBook = (fn) => {
  const run = queue.then(async () => {
    try {
      const wb = await load();
      ensureTester(wb);
      const result = await fn(wb);
      await flush(wb);
      return result;
    } catch (e) { cache = null; throw e; }
  });
  queue = run.catch(() => {});
  return run;
};

const rows = (ws) => {
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    SHEETS[ws.name].forEach((h, i) => (o[h] = row.getCell(i + 1).value));
    out.push(o);
  });
  return out;
};
const nextId = (ws, prefix) => prefix + String(ws.rowCount).padStart(4, '0'); // header counts as 1
const now = () => new Date().toLocaleString('en-IN');
const clean = (v) => String(v ?? '').trim();
const fail = (res, msg, code = 400) => res.status(code).json({ ok: false, message: msg });

// ---- Passwords are stored as salted scrypt hashes, never as plain text ----
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); };
const verifyPw = (pw, stored) => {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// ---- Tester account (always available, can act as both farmer and buyer) ----
const TESTER = {
  username: process.env.TESTER_USERNAME || CONFIG.testerUsername || 'MARCOS',
  password: process.env.TESTER_PASSWORD || CONFIG.testerPassword || '',   // no password set = no tester account
  name: 'Marcos (Tester)'
};
const TESTER_HASH = TESTER.password ? hashPw(TESTER.password) : null;
function ensureTester(wb) {
  if (!TESTER_HASH) return;
  for (const sheet of ['Farmers', 'Buyers']) {
    const ws = wb.getWorksheet(sheet);
    if (rows(ws).some((r) => String(r['Username']).toLowerCase() === TESTER.username.toLowerCase())) continue;
    const id = nextId(ws, sheet === 'Farmers' ? 'F' : 'B');
    ws.addRow(sheet === 'Farmers'
      ? [id, TESTER.name, '', '', '', now(), TESTER.username, TESTER_HASH]
      : [id, TESTER.name, '', '', '', 'UPI', now(), TESTER.username, TESTER_HASH]);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Register farmer or buyer
app.post('/api/register/:role', async (req, res) => {
  const role = req.params.role;
  const b = req.body;
  const username = clean(b.username), phone = clean(b.phone);
  if (!['farmer', 'buyer'].includes(role)) return fail(res, 'Unknown role.');
  if (!clean(b.name) || !/^\d{10}$/.test(phone) || !clean(b.address))
    return fail(res, 'Name, a 10-digit phone number and address are required.');
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) return fail(res, 'Username must be 3-20 letters, numbers, dot or underscore.');
  if (String(b.password || '').length < 6) return fail(res, 'Password must be at least 6 characters.');
  try {
    const rec = await withBook((wb) => {
      const all = [...rows(wb.getWorksheet('Farmers')), ...rows(wb.getWorksheet('Buyers'))];
      if (all.some((r) => String(r['Username']).toLowerCase() === username.toLowerCase())) throw new Error('This username is already taken.');
      if (all.some((r) => String(r['Phone']) === phone)) throw new Error('This phone number is already registered.');
      const ws = wb.getWorksheet(role === 'farmer' ? 'Farmers' : 'Buyers');
      const id = nextId(ws, role === 'farmer' ? 'F' : 'B');
      const hash = hashPw(String(b.password));
      ws.addRow(role === 'farmer'
        ? [id, clean(b.name), phone, clean(b.address), clean(b.bank), now(), username, hash]
        : [id, clean(b.name), phone, clean(b.address), clean(b.gstin), clean(b.payment), now(), username, hash]);
      return { id, name: clean(b.name) };
    });
    res.json({ ok: true, ...rec });
  } catch (e) { fail(res, e.message); }
});

// Log in with username + password
app.post('/api/login', async (req, res) => {
  const username = clean(req.body.username).toLowerCase();
  const password = String(req.body.password ?? '');
  if (!username || !password) return fail(res, 'Enter your username and password.');
  try {
    const user = await withBook((wb) => {
      const find = (sheet) => rows(wb.getWorksheet(sheet)).find((r) => String(r['Username']).toLowerCase() === username);
      const f = find('Farmers'), bu = find('Buyers');
      const acc = f || bu;
      if (!acc || !verifyPw(password, acc['Password Hash'])) return null;
      if (username === TESTER.username.toLowerCase())
        return { id: f['ID'], farmerId: f['ID'], buyerId: bu['ID'], name: TESTER.name, role: 'tester' };
      return { id: acc['ID'], name: acc['Full Name'] || acc['Full Name / Company'], role: f ? 'farmer' : 'buyer' };
    });
    if (!user) return fail(res, 'Wrong username or password.', 401);
    res.json({ ok: true, ...user });
  } catch (e) { fail(res, e.message, 500); }
});

// Crops
app.get('/api/crops', async (req, res) => {
  try {
    const crops = await withBook((wb) => rows(wb.getWorksheet('Crops')).filter((c) => Number(c['Quantity (kg)']) > 0));
    res.json(crops);
  } catch (e) { fail(res, e.message, 500); }
});

// Never let one bad request stop the whole server
process.on('unhandledRejection', (e) => console.error('Error:', e.message));

app.post('/api/crops', async (req, res) => {
  const b = req.body;
  const price = Number(b.price), qty = Number(b.quantity);
  if (!clean(b.crop) || !(price > 0) || !(qty > 0)) return fail(res, 'Crop name, price and quantity are required.');
  try {
    const rec = await withBook((wb) => {
      const farmer = rows(wb.getWorksheet('Farmers')).find((f) => f['ID'] === clean(b.farmerId).toUpperCase());
      if (!farmer) throw new Error('Farmer ID not found. Please register or sign in first.');
      const ws = wb.getWorksheet('Crops');
      const id = nextId(ws, 'C');
      ws.addRow([id, farmer['ID'], farmer['Full Name'], clean(b.crop), clean(b.category), price, qty,
        clean(b.location) || farmer['Address'] || '', now()]);
      return { id };
    });
    res.json({ ok: true, ...rec });
  } catch (e) { fail(res, e.message); }
});

// Orders - reduces stock on the listing
app.post('/api/orders', async (req, res) => {
  const b = req.body;
  const qty = Number(b.quantity);
  if (!(qty > 0)) return fail(res, 'Enter a valid quantity.');
  try {
    const rec = await withBook((wb) => {
      const buyer = rows(wb.getWorksheet('Buyers')).find((x) => x['ID'] === clean(b.buyerId).toUpperCase());
      if (!buyer) throw new Error('Buyer ID not found. Please register or sign in first.');
      const cws = wb.getWorksheet('Crops');
      let target = null;
      cws.eachRow((row, n) => { if (n > 1 && row.getCell(1).value === b.cropId) target = row; });
      if (!target) throw new Error('This listing is no longer available.');
      const stock = Number(target.getCell(7).value);
      if (qty > stock) throw new Error(`Only ${stock} kg available.`);
      target.getCell(7).value = stock - qty;
      const total = qty * Number(target.getCell(6).value);
      const ws = wb.getWorksheet('Orders');
      const id = nextId(ws, 'O');
      ws.addRow([id, buyer['ID'], buyer['Full Name / Company'], b.cropId, target.getCell(4).value,
        target.getCell(2).value, qty, total, buyer['Payment Method'] || 'UPI', 'Confirmed', now()]);
      return { id, total };
    });
    res.json({ ok: true, ...rec });
  } catch (e) { fail(res, e.message); }
});

// Orders + receipts for one user, and personal info
app.post('/api/my-orders', async (req, res) => {
  const bId = clean(req.body.buyerId).toUpperCase(), fId = clean(req.body.farmerId).toUpperCase();
  try {
    const list = await withBook((wb) => {
      const farmers = rows(wb.getWorksheet('Farmers')), buyers = rows(wb.getWorksheet('Buyers'));
      return rows(wb.getWorksheet('Orders')).filter((o) => (bId && o['Buyer ID'] === bId) || (fId && o['Farmer ID'] === fId)).reverse().map((o) => {
        const f = farmers.find((x) => x['ID'] === o['Farmer ID']) || {}, b = buyers.find((x) => x['ID'] === o['Buyer ID']) || {};
        const qty = Number(o['Quantity (kg)']), total = Number(o['Total (Rs)']);
        return { ...o, 'Rate (Rs/kg)': qty ? total / qty : 0, 'Farmer Name': f['Full Name'] || '', 'Farmer Phone': String(f['Phone'] || ''), 'Buyer Phone': String(b['Phone'] || ''),
          'Delivery Address': b['Delivery Address'] || '', side: o['Buyer ID'] === bId ? 'bought' : 'sold' };
      });
    });
    res.json(list);
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/profile', async (req, res) => {
  try {
    const u = await withBook((wb) => [...rows(wb.getWorksheet('Farmers')), ...rows(wb.getWorksheet('Buyers'))].find((x) => x['ID'] === clean(req.body.id).toUpperCase()));
    if (!u) return fail(res, 'Account not found.', 404);
    const { Salt, 'Password Hash': h, ...profile } = u;
    res.json({ ok: true, profile });
  } catch (e) { fail(res, e.message, 500); }
});

if (MODE === 'excel') {
  // Move records from the old location (project/data) the first time, then create the file right away
  const old = path.join(__dirname, 'data', 'marketplace.xlsx');
  try { fs.mkdirSync(DIR, { recursive: true }); if (!fs.existsSync(FILE) && fs.existsSync(old)) fs.copyFileSync(old, FILE); } catch (e) { console.error(e.message); }
  withBook(async () => {}).catch((e) => console.error('Could not prepare the Excel file:', e.message));
}

app.listen(PORT, () => console.log(`Agricultural Marketplace running at http://localhost:${PORT}\nRecords are saved in ${MODE === 'excel' ? FILE : 'your Google Sheet'}`));
