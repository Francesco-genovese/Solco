// Solco — logica condivisa tra le pagine.

const CONDITION_LABELS = { M: 'Mint', NM: 'Near Mint', 'VG+': 'Very Good Plus', VG: 'Very Good', 'G+': 'Good Plus', G: 'Good', F: 'Fair', P: 'Poor' };
const CONDITION_CODES = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'];
const COVER_PALETTE = ['#201e1d', '#1440d8', '#8ba2ff', '#bab6b6', '#d7d3d3', '#0d1a45'];

// --- registra il service worker (solo se non già registrato) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// --- chiamate API: gestisce la sessione scaduta in automatico ---
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  });
  if (res.status === 401) { location.href = '/login.html'; return null; }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Errore ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// --- feedback fisico: vibrazione breve, solo nei momenti chiave ---
function haptic(pattern = 15) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
const HAPTIC = { tap: 12, success: [15, 40, 15], recognized: 30, error: [20, 60, 20] };

// --- toast ---
let toastTimer = null;
function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// --- bottom sheet (pannello secondario per modifica / elimina / impostazioni) ---
function openSheet(id) {
  document.getElementById('sheet-backdrop')?.classList.add('open');
  document.getElementById(id)?.classList.add('open');
}
function closeSheet(id) {
  document.getElementById('sheet-backdrop')?.classList.remove('open');
  document.getElementById(id)?.classList.remove('open');
}

// --- utilità ---
function formatEuro(n) {
  if (n === null || n === undefined) return '—';
  return '€ ' + Math.round(n).toLocaleString('it-IT');
}
function coverColorFor(album) { return album.cover_color || COVER_PALETTE[album.id % COVER_PALETTE.length]; }

// --- copertina: foto vera se c'è, altrimenti un blocco di colore col motivo del logo ---
const COVER_FALLBACK_SVG = `<svg class="cover-fallback-mark" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
  <line x1="22" y1="78" x2="78" y2="22" stroke="#ffffff" stroke-width="2.4"/>
  <circle cx="61" cy="39" r="7.5" fill="#ffffff"/>
</svg>`;
function coverMediaHtml(album) {
  if (album.cover_url) return `<img src="${album.cover_url}" alt="">`;
  return `<div style="position:absolute;inset:0;background:${coverColorFor(album)}"></div>${COVER_FALLBACK_SVG}`;
}

// --- card di un disco per le griglie (Libreria, Amici, Profilo) ---
function recordCardHtml(a, href) {
  href = href === undefined ? `/disco.html?id=${a.id}` : href;
  const favBadge = a.is_favorite ? '<span class="fav-badge">★</span>' : '';
  const cover = a.cover_url
    ? `<div class="record-cover cover-media" style="padding:0">${favBadge}<img src="${a.cover_url}" alt=""></div>`
    : `<div class="record-cover">${favBadge}<div style="position:absolute;inset:0;background:${coverColorFor(a)}"></div>${COVER_FALLBACK_SVG}<div class="cover-title" style="position:relative;color:#fff">${a.title}</div></div>`;
  const tag = href ? 'a' : 'div';
  return `<${tag} class="record-card"${href ? ` href="${href}"` : ''}>
    ${cover}
    <div class="record-artist">${a.artist}</div>
    <div class="record-meta"><span>${a.condition_media}</span><span>${formatEuro(a.value_estimate)}</span></div>
  </${tag}>`;
}

// --- riga di un disco per la vista lista ---
function recordListRowHtml(a, href) {
  href = href === undefined ? `/disco.html?id=${a.id}` : href;
  return `<a class="list-row" href="${href}">
    <div class="list-cover cover-media">${coverMediaHtml(a)}</div>
    <div>
      <div class="list-row-title">${a.title}${a.is_favorite ? ' ★' : ''}</div>
      <div class="list-row-meta">${a.artist}</div>
    </div>
    <div class="list-row-right">${a.condition_media}<br>${formatEuro(a.value_estimate)}</div>
  </a>`;
}
function debounce(fn, ms = 250) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

// --- logout ---
async function doLogout() { await fetch('/api/logout'); location.href = '/login.html'; }

// --- utente corrente (per header/pannello impostazioni) ---
async function loadCurrentUser() {
  try { return await api('/api/me'); } catch { return null; }
}

// --- pulsante profilo condiviso in cima alle schermate principali: mostra l'avatar
// vero (o l'iniziale) al posto di un'icona generica, e apre il pannello con bio,
// link al profilo, eventuale pannello admin e uscita. Richiede nel markup della
// pagina: #profile-btn, #profile-sheet, #sheet-backdrop, #profile-username,
// #profile-bio, #profile-avatar, #admin-link-wrap (opzionale), #logout-btn.
async function initProfileMenu() {
  const btn = document.getElementById('profile-btn');
  const me = await loadCurrentUser();
  if (!me) return me;

  const avatarHtml = me.avatar_url
    ? `<img src="${me.avatar_url}" style="width:100%;height:100%;object-fit:cover">`
    : `<span style="font-family:var(--font-heading);font-weight:800;color:var(--color-neutral-700)">${me.username[0].toUpperCase()}</span>`;

  if (btn) { btn.innerHTML = avatarHtml; btn.addEventListener('click', () => openSheet('profile-sheet')); }
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.innerHTML = avatarHtml;
  const nameEl = document.getElementById('profile-username');
  if (nameEl) nameEl.textContent = me.username;
  const bioEl = document.getElementById('profile-bio');
  if (bioEl) bioEl.textContent = me.bio || '';
  if (me.role === 'Amministratore') {
    const adminWrap = document.getElementById('admin-link-wrap');
    if (adminWrap) adminWrap.style.display = 'block';
  }
  document.getElementById('sheet-backdrop')?.addEventListener('click', () => closeSheet('profile-sheet'));
  document.getElementById('logout-btn')?.addEventListener('click', doLogout);
  return me;
}

// --- ridimensiona una foto scelta dal telefono in un piccolo avatar quadrato ---
// evita di salvare nel database immagini enormi: tutto resta locale finché non è pronto.
function resizeImageToDataUrl(file, maxSize = 320, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('lettura immagine fallita'));
    reader.onload = () => {
      img.onerror = () => reject(new Error('immagine non valida'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = maxSize; canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
