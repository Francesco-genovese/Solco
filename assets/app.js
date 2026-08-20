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
function debounce(fn, ms = 250) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

// --- logout ---
async function doLogout() { await fetch('/api/logout'); location.href = '/login.html'; }

// --- utente corrente (per header/pannello impostazioni) ---
async function loadCurrentUser() {
  try { return await api('/api/me'); } catch { return null; }
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
