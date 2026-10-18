// Khet2Ghar front-end. Flow: splash -> log in / sign up -> role -> account form -> home.
// The login is saved on this device, so the user is not asked to log in again.
const $ = (s) => document.querySelector(s);
const ICONS = { Vegetables: '🥬', Fruits: '🍎', Grains: '🌾', Pulses: '🫘', Dairy: '🥛', Other: '🧺' };
const NAME_ICONS = { tomato: '🍅', potato: '🥔', apple: '🍎', wheat: '🌾', onion: '🧅', mango: '🥭', banana: '🍌', carrot: '🥕', corn: '🌽', rice: '🍚', chilli: '🌶️', brinjal: '🍆' };
const SCREENS = ['auth', 'role', 'farmer', 'buyer', 'home'];
let crops = [], selected = null, splashDone = false;
let user = JSON.parse(localStorage.getItem('k2g_user') || 'null');

const money = (n) => '₹' + Number(n).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iconFor = (c) => {
  const n = String(c.Crop).toLowerCase();
  const hit = Object.keys(NAME_ICONS).find((k) => n.includes(k));
  return hit ? NAME_ICONS[hit] : ICONS[c.Category] || '🧺';
};

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast.id);
  toast.id = setTimeout(() => (t.className = 'toast'), 3800);
}

async function api(url, data) {
  const res = await fetch(url, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  const json = await res.json();
  if (json.ok === false) throw new Error(json.message);
  return json;
}

/* ---------- Routing between screens ---------- */
function route() {
  if (!splashDone) return;
  let name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  if (!SCREENS.includes(name)) name = null;
  if (user) name = 'home';                 // logged-in users never see login/sign-up again
  else if (!name || name === 'home') name = 'auth';
  SCREENS.forEach((s) => ($('#' + s).hidden = s !== name));
  if (name === 'home') { renderHome(); loadCrops(); loadActivity(); }
  if (!location.hash.startsWith('#/') || (user && location.hash !== '#/home' && !/^#(market|sell|activity|how|top)$/.test(location.hash)))
    history.replaceState(null, '', user ? '#/home' : '#/' + name);
  if (name !== 'home') window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => {
  if (/^#(market|sell|activity|how|top)$/.test(location.hash)) return; // in-page anchors on home
  route();
});

function setUser(u) { user = u; localStorage.setItem('k2g_user', JSON.stringify(u)); location.hash = '#/home'; route(); }
function logout() { user = null; localStorage.removeItem('k2g_user'); location.hash = '#/auth'; route(); toast('You have logged out.'); }

function renderHome() {
  const farmer = user.role !== 'buyer';
  renderAvatar();
  $('#greet').textContent = `Namaste, ${user.name.split(' ')[0]}. ${farmer ? 'Your crops, your price.' : 'Fresh produce is waiting.'}`;
  ['#sell', '#sellLink', '#heroSell'].forEach((s) => ($(s).hidden = !farmer));
}

/* ---------- Splash ---------- */
function startSplash() {
  const finish = () => {
    $('#splash').classList.add('done');
    splashDone = true;
    route();
  };
  setTimeout(finish, matchMedia('(prefers-reduced-motion: reduce)').matches ? 600 : 3400);
}

/* ---------- Log in / Sign up tabs ---------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
  $('#loginForm').hidden = t.dataset.tab !== 'login';
  $('#signupBox').hidden = t.dataset.tab !== 'signup';
}));

/* ---------- Forms ---------- */
function validate(form) {
  let ok = true;
  form.querySelectorAll('[required]').forEach((el) => {
    const v = el.value.trim();
    const bad = !v || (el.name === 'phone' && !/^\d{10}$/.test(v)) ||
      (el.name === 'username' && form.id !== 'loginForm' && !/^[A-Za-z0-9_.]{3,20}$/.test(v)) ||
      (el.name === 'password' && form.id !== 'loginForm' && el.value.length < 6);
    el.classList.toggle('invalid', bad);
    if (bad) ok = false;
  });
  if (!ok) toast('Please fix the highlighted fields. Phone: 10 digits. Username: 3-20 letters or numbers. Password: 6+ characters.', true);
  return ok;
}

async function submit(form, fn) {
  if (!validate(form)) return;
  const btn = form.querySelector('button[type=submit]');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try { await fn(Object.fromEntries(new FormData(form))); }
  catch (e) { toast(e instanceof TypeError ? 'Cannot reach the server. Run "npm start" and open http://localhost:3000 in the browser.' : e.message, true); }
  btn.disabled = false; btn.textContent = label;
}

['farmer', 'buyer'].forEach((role) => {
  const form = $(`#${role}Form`);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(form, async (data) => {
      const r = await api(`/api/register/${role}`, data);
      form.reset();
      setUser({ id: r.id, name: r.name, role });
      toast(`Account created. Your ID is ${r.id}.`);
    });
  });
});

$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submit(e.target, async (data) => {
    const r = await api('/api/login', data);
    e.target.reset();
    setUser({ id: r.id, name: r.name, role: r.role, farmerId: r.farmerId, buyerId: r.buyerId });
  });
});

$('#cropForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  submit(form, async (data) => {
    await api('/api/crops', { ...data, farmerId: user.farmerId || user.id });
    form.reset();
    toast('Crop listed. Buyers can see it now.');
    loadCrops();
  });
});

/* ---------- Profile (top right) ---------- */
const initials = (n) => String(n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const roleLabel = (r) => (r === 'farmer' ? 'Farmer' : r === 'buyer' ? 'Buyer' : 'Tester');

function renderAvatar() {
  const ini = esc(initials(user.name));
  $('#session').innerHTML = `
    <button class="avatar ${user.role}" id="avatarBtn" aria-haspopup="true" aria-expanded="false" title="My profile">${ini}</button>
    <div class="profile" id="profilePanel" hidden>
      <div class="p-head"><div class="avatar big ${user.role}">${ini}</div>
        <div><b>${esc(user.name)}</b><br><span class="badge">${roleLabel(user.role)} · ${esc(user.id)}</span></div></div>
      <dl id="profileInfo"><div><dt>Loading…</dt><dd></dd></div></dl>
      <div class="p-actions"><a class="btn small ghost dark-text" href="#activity" id="pAct">My activity</a><button class="btn small dark" id="out">Log out</button></div>
    </div>`;
  $('#out').onclick = logout;
  $('#pAct').onclick = () => ($('#profilePanel').hidden = true);
  $('#avatarBtn').onclick = async (e) => {
    e.stopPropagation();
    const panel = $('#profilePanel');
    panel.hidden = !panel.hidden;
    $('#avatarBtn').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) fillProfile();
  };
}

async function fillProfile() {
  const fields = user.role === 'farmer' ? [['Phone', 'Phone'], ['Address', 'Address'], ['Bank / UPI', 'Bank / UPI']]
    : user.role === 'buyer' ? [['Phone', 'Phone'], ['Delivery address', 'Delivery Address'], ['GSTIN', 'GSTIN'], ['Payment', 'Payment Method']]
    : [['Account', '_tester']];
  try {
    const { profile: p } = await api('/api/profile', { id: user.id });
    const val = (k) => (k === '_tester' ? 'Tester (works as farmer and buyer)' : p[k]);
    const all = [...fields, ['Username', 'Username'], ['Member since', 'Registered On']];
    $('#profileInfo').innerHTML = all.map(([label, k]) => `<div><dt>${label}</dt><dd>${esc(val(k)) || '<span class="muted">Not added</span>'}</dd></div>`).join('');
  } catch (e) { $('#profileInfo').innerHTML = '<div><dt>Could not load details.</dt><dd></dd></div>'; }
}
document.addEventListener('click', (e) => { const p = $('#profilePanel'); if (p && !p.hidden && !e.target.closest('.session')) p.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#profilePanel')) $('#profilePanel').hidden = true; });

/* ---------- Recent activity: orders and receipts ---------- */
let activity = [];
async function loadActivity() {
  try {
    activity = await api('/api/my-orders', {
      buyerId: user.buyerId || (user.role === 'buyer' ? user.id : ''),
      farmerId: user.farmerId || (user.role === 'farmer' ? user.id : '')
    });
    if (!Array.isArray(activity)) activity = [];
  } catch (e) { activity = []; }
  $('#activityTitle').textContent = user.role === 'farmer' ? 'Orders received' : user.role === 'buyer' ? 'Your orders' : 'Recent orders';
  $('#activityList').innerHTML = activity.length ? activity.map((o) => `
    <article class="act">
      <div class="act-main"><span><b>${esc(o.Crop)}</b><span class="tag ${o.side}">${o.side === 'sold' ? 'Sold' : 'Bought'}</span></span>
        <small>${esc(o['Ordered On'])} · Order ${esc(o.ID)}</small></div>
      <div>${esc(o['Quantity (kg)'])} kg</div>
      <div class="act-total">${money(o['Total (Rs)'])}</div>
      <button class="btn small dark" data-receipt="${esc(o.ID)}">Receipt</button>
    </article>`).join('')
    : '<div class="empty">No orders yet. Your orders and their receipts will appear here.</div>';
}

function receiptHtml(o) {
  return `<h3>Khet2Ghar</h3><div class="muted">Order receipt</div>
    <div class="meta"><span>Receipt no: <b>${esc(o.ID)}</b></span><span>${esc(o['Ordered On'])}</span></div>
    <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
      <tr><td>${esc(o.Crop)}</td><td class="r">${esc(o['Quantity (kg)'])} kg</td><td class="r">${money(o['Rate (Rs/kg)'])}/kg</td><td class="r">${money(o['Total (Rs)'])}</td></tr>
      <tr class="grand"><td colspan="3">Total amount</td><td class="r">${money(o['Total (Rs)'])}</td></tr></tbody></table>
    <div class="parties">
      <div><b>Buyer</b><br>${esc(o['Buyer Name'])}<br>${esc(o['Buyer Phone'] || '')}<br>${esc(o['Delivery Address'] || '')}</div>
      <div><b>Farmer</b><br>${esc(o['Farmer Name'])}<br>${esc(o['Farmer Phone'] || '')}<br>ID ${esc(o['Farmer ID'])}</div>
    </div>
    <div>Payment method: <b>${esc(o.Payment)}</b> <span class="stamp">${esc(o.Status)}</span></div>
    <p class="muted">This is a computer-generated receipt.</p>`;
}
$('#activityList').addEventListener('click', (e) => {
  const o = activity.find((x) => x.ID === e.target.dataset.receipt);
  if (!o) return;
  $('#receiptBody').innerHTML = receiptHtml(o);
  $('#receiptDlg').showModal();
});
$('#receiptClose').addEventListener('click', () => $('#receiptDlg').close());
$('#receiptPrint').addEventListener('click', () => window.print());

/* ---------- Marketplace ---------- */
async function loadCrops() {
  try { crops = await (await fetch('/api/crops')).json(); if (!Array.isArray(crops)) throw new Error(); }
  catch { crops = []; $('#stats').textContent = 'Start the server to see live listings.'; }
  renderCrops();
}

function renderCrops() {
  const q = $('#q').value.toLowerCase(), cat = $('#cat').value, loc = $('#loc').value.toLowerCase(), sort = $('#sort').value;
  const list = crops.filter((c) =>
    String(c.Crop).toLowerCase().includes(q) && (!cat || c.Category === cat) && String(c.Location).toLowerCase().includes(loc));
  if (sort === 'low') list.sort((a, b) => a['Price (Rs/kg)'] - b['Price (Rs/kg)']);
  else if (sort === 'high') list.sort((a, b) => b['Price (Rs/kg)'] - a['Price (Rs/kg)']);
  else list.reverse();

  $('#stats').textContent = `${crops.length} live listing${crops.length === 1 ? '' : 's'} from ${new Set(crops.map((c) => c['Farmer ID'])).size} farmer(s).`;
  const canOrder = user && user.role !== 'farmer';
  $('#grid').innerHTML = list.length ? list.map((c) => `
    <article class="crop">
      <div class="pic" aria-hidden="true">${iconFor(c)}</div>
      <div class="body">
        <h3>${esc(c.Crop)}</h3>
        <div class="price">${money(c['Price (Rs/kg)'])}<small> / kg</small></div>
        <div class="meta">${esc(c['Quantity (kg)'])} kg available · ${esc(c.Category)}</div>
        <div class="meta">${esc(c['Farmer Name'])}${c.Location ? ', ' + esc(c.Location) : ''}</div>
        ${canOrder ? `<button class="btn dark" data-id="${esc(c.ID)}">Order now</button>` : ''}
      </div>
    </article>`).join('')
    : '<div class="empty">No produce matches yet. Farmers can add listings and they will appear here.</div>';
}

['#q', '#cat', '#loc', '#sort'].forEach((s) => $(s).addEventListener('input', renderCrops));

const dlg = $('#orderDlg');
const orderMsg = (t) => { const m = $('#orderMsg'); m.textContent = t || ''; m.hidden = !t; };

$('#grid').addEventListener('click', (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  selected = crops.find((c) => c.ID === id);
  if (!selected) return;
  $('#orderTitle').textContent = `Order ${selected.Crop}`;
  $('#orderInfo').textContent = `${money(selected['Price (Rs/kg)'])} per kg · ${selected['Quantity (kg)']} kg available · ${selected['Farmer Name']}`;
  $('#orderQty').value = '';
  $('#orderTotal').textContent = money(0);
  orderMsg('');
  $('#orderForm').hidden = false;
  $('#orderDone').hidden = true;
  dlg.showModal();
  $('#orderQty').focus();
});

$('#orderQty').addEventListener('input', (e) => {
  $('#orderTotal').textContent = money((Number(e.target.value) || 0) * selected['Price (Rs/kg)']);
});
$('#orderCancel').addEventListener('click', () => dlg.close());
$('#orderDoneBtn').addEventListener('click', () => dlg.close());

$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault(); // Enter key and the button both land here
  const qty = Number($('#orderQty').value), stock = Number(selected['Quantity (kg)']);
  if (!(qty > 0)) return orderMsg('Enter how many kg you want.');
  if (qty > stock) return orderMsg(`Only ${stock} kg is available.`);
  const btn = $('#orderBtn');
  btn.disabled = true; btn.textContent = 'Placing order…'; orderMsg('');
  try {
    const r = await api('/api/orders', { buyerId: user.buyerId || user.id, cropId: selected.ID, quantity: qty });
    $('#orderDoneText').innerHTML = `Order <b>${esc(r.id)}</b> is confirmed.<br>${qty} kg of ${esc(selected.Crop)} · Total <b>${money(r.total)}</b><br>The farmer has been notified.`;
    $('#orderForm').hidden = true;
    $('#orderDone').hidden = false;
    loadCrops();
    loadActivity();
  } catch (err) {
    orderMsg(err instanceof TypeError ? 'Could not reach the database. Check your internet, or that the server is running.' : err.message);
  }
  btn.disabled = false; btn.textContent = 'Place order';
});

startSplash();
