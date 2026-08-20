// =========================================================
// Solco — worker.js
// Base di autenticazione dal tutorial Cloudflare Workers + D1,
// con sopra le rotte specifiche della libreria vinili.
// =========================================================

const SESSION_HOURS = 12;
const ADMIN_ONLY_PAGES = new Set(['/admin.html']);

// Pagine raggiungibili anche senza sessione attiva e anche da desktop
// (servono al flusso di installazione / login, prima che l'utente sia dentro).
const PUBLIC_PAGES = new Set(['/login.html', '/register.html', '/install.html']);

// Scala Goldmine: peso numerico per medie e ordinamento.
const CONDITION_WEIGHT = { M: 8, NM: 7, 'VG+': 6, VG: 5, 'G+': 4, G: 3, F: 2, P: 1 };
const CONDITION_ORDER = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'];
function conditionBucket(code) {
  if (code === 'M' || code === 'NM') return 'mint_nm';
  if (code === 'VG+') return 'vgplus';
  if (code === 'VG') return 'vg';
  if (code === 'G+' || code === 'G') return 'good';
  return 'fair_poor';
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

function isMobileUA(request) {
  const ua = request.headers.get('User-Agent') || '';
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
}

// chi ha premuto "Continua comunque" su install.html porta questo cookie:
// da desktop l'avviso resta, ma non blocca più chi vuole entrare comunque.
function hasDesktopOverride(request) {
  return getCookie(request, 'desktop_ok') === '1';
}

// --- utilità condivise (dal tutorial) ---

function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function toB64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function fromB64(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const iterations = parseInt(iterStr, 10);
  const salt = fromB64(saltB64);
  const expected = fromB64(hashB64);
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
async function hashPassword(password) {
  const iterations = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return 'pbkdf2$' + iterations + '$' + toB64(salt) + '$' + toB64(new Uint8Array(bits));
}

async function getSessionUser(request, env) {
  const token = getCookie(request, 'session');
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.username, u.email, u.role, u.status, u.avatar_url
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date() || row.status === 'sospeso') {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return row;
}
function sessionCookie(token, maxAgeSeconds) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

// --- Discogs (best-effort: se manca il token, l'app resta usabile a mano) ---

async function discogsSearch(env, params) {
  if (!env.DISCOGS_TOKEN) return { configured: false, candidates: [] };
  const url = new URL('https://api.discogs.com/database/search');
  url.searchParams.set('type', 'release');
  url.searchParams.set('token', env.DISCOGS_TOKEN);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { 'User-Agent': 'SolcoApp/1.0 (+uso privato)' } });
  if (!res.ok) return { configured: true, candidates: [] };
  const data = await res.json().catch(() => ({ results: [] }));
  const candidates = (data.results || []).slice(0, 6).map(r => {
    let artist = '', title = r.title || '';
    if (title.includes(' - ')) { const parts = title.split(' - '); artist = parts[0]; title = parts.slice(1).join(' - '); }
    return {
      discogs_release_id: String(r.id),
      artist, title,
      label: (r.label && r.label[0]) || null,
      catalog_number: r.catno || null,
      year: r.year ? parseInt(r.year, 10) : null,
      country: r.country || null,
      genre: (r.genre && r.genre[0]) || (r.style && r.style[0]) || null,
      thumb: r.thumb || null,
    };
  });
  return { configured: true, candidates };
}

async function discogsPriceSuggestion(env, releaseId, conditionMedia) {
  if (!env.DISCOGS_TOKEN || !releaseId) return null;
  try {
    const url = `https://api.discogs.com/marketplace/price_suggestions/${releaseId}?token=${env.DISCOGS_TOKEN}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SolcoApp/1.0 (+uso privato)' } });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    const map = { M: 'Mint (M)', NM: 'Near Mint (NM or M-)', 'VG+': 'Very Good Plus (VG+)', VG: 'Very Good (VG)', 'G+': 'Good Plus (G+)', G: 'Good (G)', F: 'Fair (F)', P: 'Poor (P)' };
    const entry = data[map[conditionMedia]];
    if (!entry) return null;
    return { value_estimate: entry.value, currency: entry.currency };
  } catch { return null; }
}

// --- API ---

async function handleApi(request, env, pathname, method) {
  // --- rotte pubbliche (login, bootstrap, invito) ---

  if (pathname === '/api/login' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.username || !body.password) return json({ error: 'credenziali mancanti' }, 400);
    const user = await env.DB.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').bind(body.username).first();
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return json({ error: 'credenziali non valide' }, 401);
    }
    if (user.status === 'sospeso') return json({ error: 'account sospeso' }, 403);
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expires).run();
    await env.DB.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();
    await env.DB.prepare("INSERT INTO activity_log (actor, action, status) VALUES (?, 'login effettuato', 'ok')").bind(user.username).run();
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', sessionCookie(token, SESSION_HOURS * 3600));
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // bootstrap: se non esiste ancora nessun account, crea il primo Amministratore.
  if (pathname === '/api/bootstrap' && method === 'POST') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
    if (count.c > 0) return json({ error: 'esiste già un account, il bootstrap è chiuso' }, 403);
    const body = await request.json().catch(() => null);
    if (!body || !body.username || !body.email || !body.password) return json({ error: 'compila tutti i campi' }, 400);
    const hash = await hashPassword(body.password);
    await env.DB.prepare("INSERT INTO users (username, email, role, status, password_hash) VALUES (?, ?, 'Amministratore', 'ok', ?)")
      .bind(body.username.trim(), body.email.trim(), hash).run();
    return json({ ok: true });
  }

  // registrazione con codice di invito (per aggiungere le "poche persone" oltre al primo admin)
  if (pathname === '/api/register' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.code || !body.username || !body.email || !body.password) return json({ error: 'compila tutti i campi' }, 400);
    const invite = await env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(body.code.trim()).first();
    if (!invite || invite.used_by) return json({ error: 'codice invito non valido o già usato' }, 403);
    const hash = await hashPassword(body.password);
    await env.DB.prepare("INSERT INTO users (username, email, role, status, password_hash) VALUES (?, ?, 'Utente', 'ok', ?)")
      .bind(body.username.trim(), body.email.trim(), hash).run();
    await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?').bind(body.username.trim(), body.code.trim()).run();
    return json({ ok: true });
  }

  if (pathname === '/api/logout') {
    const token = getCookie(request, 'session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    const headers = new Headers({ Location: '/login.html' });
    headers.append('Set-Cookie', sessionCookie('', 0));
    return new Response(null, { status: 302, headers });
  }

  // --- da qui in poi, tutto richiede sessione valida ---

  const sessionUser = await getSessionUser(request, env);
  if (!sessionUser) return json({ error: 'non autenticato' }, 401);

  if (pathname === '/api/me' && method === 'GET') {
    const full = await env.DB.prepare('SELECT bio, created_at FROM users WHERE id = ?').bind(sessionUser.id).first();
    return json({
      username: sessionUser.username, email: sessionUser.email, role: sessionUser.role,
      avatar_url: sessionUser.avatar_url || null, bio: full?.bio || null, created_at: full?.created_at || null,
    });
  }

  if (pathname === '/api/me' && method === 'PATCH') {
    const b = await request.json().catch(() => ({}));
    if (b.avatar_url && b.avatar_url.length > 350000) return json({ error: 'immagine troppo grande' }, 400);
    const sets = [], vals = [];
    if ('bio' in b) { sets.push('bio = ?'); vals.push((b.bio || '').slice(0, 280) || null); }
    if ('avatar_url' in b) { sets.push('avatar_url = ?'); vals.push(b.avatar_url || null); }
    if (sets.length === 0) return json({ error: 'niente da aggiornare' }, 400);
    vals.push(sessionUser.id);
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
    return json({ ok: true });
  }

  // --- amici: altri membri della libreria privata e le loro collezioni ---

  if (pathname === '/api/friends' && method === 'GET') {
    const { results: users } = await env.DB.prepare(
      "SELECT username, avatar_url, bio FROM users WHERE username != ? AND status = 'ok' ORDER BY username"
    ).bind(sessionUser.username).all();
    const { results: agg } = await env.DB.prepare(
      'SELECT added_by, COUNT(*) AS count, SUM(value_estimate) AS total_value FROM album GROUP BY added_by'
    ).all();
    const aggMap = Object.fromEntries(agg.map(a => [a.added_by, a]));
    const friends = users.map(u => ({
      username: u.username, avatar_url: u.avatar_url || null, bio: u.bio || null,
      count: aggMap[u.username]?.count || 0, total_value: Math.round(aggMap[u.username]?.total_value || 0),
    }));
    return json({ friends });
  }

  const friendMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);
  if (friendMatch && method === 'GET') {
    const username = decodeURIComponent(friendMatch[1]);
    const user = await env.DB.prepare("SELECT username, avatar_url, bio, created_at FROM users WHERE username = ? AND status = 'ok'").bind(username).first();
    if (!user) return json({ error: 'non trovato' }, 404);
    const { results: albums } = await env.DB.prepare('SELECT * FROM album WHERE added_by = ? ORDER BY added_at DESC').bind(username).all();
    return json({ user, albums });
  }

  // --- amministrazione utenti / inviti (solo Amministratore) ---

  if (pathname === '/api/users' && method === 'GET') {
    if (sessionUser.role !== 'Amministratore') return json({ error: 'non autorizzato' }, 403);
    const { results } = await env.DB.prepare('SELECT id, username, email, role, status, last_login FROM users ORDER BY id').all();
    return json({ users: results });
  }

  const userIdMatch = pathname.match(/^\/api\/users\/(\d+)$/);
  if (userIdMatch && method === 'PATCH') {
    if (sessionUser.role !== 'Amministratore') return json({ error: 'non autorizzato' }, 403);
    const body = await request.json().catch(() => ({}));
    if (body.status) await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(body.status, userIdMatch[1]).run();
    if (body.role) await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(body.role, userIdMatch[1]).run();
    return json({ ok: true });
  }

  if (pathname === '/api/invites' && method === 'POST') {
    if (sessionUser.role !== 'Amministratore') return json({ error: 'non autorizzato' }, 403);
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    await env.DB.prepare('INSERT INTO invites (code, created_by) VALUES (?, ?)').bind(code, sessionUser.username).run();
    return json({ code });
  }
  if (pathname === '/api/invites' && method === 'GET') {
    if (sessionUser.role !== 'Amministratore') return json({ error: 'non autorizzato' }, 403);
    const { results } = await env.DB.prepare('SELECT code, created_by, used_by, created_at FROM invites ORDER BY created_at DESC LIMIT 20').all();
    return json({ invites: results });
  }

  // --- riconoscimento disco (scansione) ---

  if (pathname === '/api/lookup' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.value) return json({ error: 'valore mancante' }, 400);
    const params = body.type === 'barcode' ? { barcode: body.value } : { q: body.value };
    const result = await discogsSearch(env, params);
    return json(result);
  }

  // --- libreria: album ---

  if (pathname === '/api/album' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM album WHERE added_by = ? ORDER BY added_at DESC').bind(sessionUser.username).all();
    return json({ albums: results });
  }

  if (pathname === '/api/album' && method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b || !b.artist || !b.title) return json({ error: 'artista e titolo sono obbligatori' }, 400);
    const palette = ['#201e1d', '#1440d8', '#8ba2ff', '#bab6b6', '#d7d3d3', '#0d1a45'];
    const coverColor = b.cover_color || palette[Math.floor(Math.random() * palette.length)];
    const result = await env.DB.prepare(
      `INSERT INTO album (artist, title, label, catalog_number, year, genre, country, barcode, matrix_a, matrix_b,
        discogs_release_id, condition_media, condition_sleeve, pressing_note, value_estimate, value_low, value_high,
        notes, cover_color, added_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      b.artist, b.title, b.label || null, b.catalog_number || null, b.year || null, b.genre || null, b.country || null,
      b.barcode || null, b.matrix_a || null, b.matrix_b || null, b.discogs_release_id || null,
      b.condition_media || 'VG', b.condition_sleeve || null, b.pressing_note || null,
      b.value_estimate || null, b.value_low || null, b.value_high || null, b.notes || null,
      coverColor, sessionUser.username
    ).run();
    await env.DB.prepare("INSERT INTO activity_log (actor, action) VALUES (?, ?)").bind(sessionUser.username, `ha aggiunto "${b.title}"`).run();
    return json({ ok: true, id: result.meta.last_row_id });
  }

  const albumIdMatch = pathname.match(/^\/api\/album\/(\d+)$/);
  if (albumIdMatch) {
    const id = albumIdMatch[1];
    if (method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM album WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'non trovato' }, 404);
      return json({ album: row });
    }
    if (method === 'PATCH') {
      const owner = await env.DB.prepare('SELECT added_by FROM album WHERE id = ?').bind(id).first();
      if (!owner) return json({ error: 'non trovato' }, 404);
      if (owner.added_by !== sessionUser.username) return json({ error: 'non è un disco tuo' }, 403);
      const b = await request.json().catch(() => ({}));
      const fields = ['artist', 'title', 'label', 'catalog_number', 'year', 'genre', 'country', 'condition_media',
        'condition_sleeve', 'pressing_note', 'value_estimate', 'value_low', 'value_high', 'notes'];
      const sets = [], vals = [];
      for (const f of fields) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]); }
      if (sets.length === 0) return json({ error: 'niente da aggiornare' }, 400);
      vals.push(id);
      await env.DB.prepare(`UPDATE album SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const owner = await env.DB.prepare('SELECT added_by FROM album WHERE id = ?').bind(id).first();
      if (!owner) return json({ error: 'non trovato' }, 404);
      if (owner.added_by !== sessionUser.username) return json({ error: 'non è un disco tuo' }, 403);
      await env.DB.prepare('DELETE FROM album WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  // --- da cercare (wishlist) ---

  if (pathname === '/api/wishlist' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM wishlist WHERE added_by = ? ORDER BY priority ASC, added_at DESC').bind(sessionUser.username).all();
    return json({ wishlist: results });
  }
  if (pathname === '/api/wishlist' && method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b || !b.artist || !b.title) return json({ error: 'artista e titolo sono obbligatori' }, 400);
    const result = await env.DB.prepare('INSERT INTO wishlist (artist, title, note, priority, added_by) VALUES (?,?,?,?,?)')
      .bind(b.artist, b.title, b.note || null, b.priority || 2, sessionUser.username).run();
    return json({ ok: true, id: result.meta.last_row_id });
  }
  const wishIdMatch = pathname.match(/^\/api\/wishlist\/(\d+)$/);
  if (wishIdMatch && method === 'DELETE') {
    const wish = await env.DB.prepare('SELECT added_by FROM wishlist WHERE id = ?').bind(wishIdMatch[1]).first();
    if (wish && wish.added_by !== sessionUser.username) return json({ error: 'non è tuo' }, 403);
    await env.DB.prepare('DELETE FROM wishlist WHERE id = ?').bind(wishIdMatch[1]).run();
    return json({ ok: true });
  }
  if (wishIdMatch && method === 'PATCH') {
    const wish = await env.DB.prepare('SELECT added_by FROM wishlist WHERE id = ?').bind(wishIdMatch[1]).first();
    if (wish && wish.added_by !== sessionUser.username) return json({ error: 'non è tuo' }, 403);
    const b = await request.json().catch(() => ({}));
    if (b.priority) await env.DB.prepare('UPDATE wishlist SET priority = ? WHERE id = ?').bind(b.priority, wishIdMatch[1]).run();
    return json({ ok: true });
  }

  // trovato in negozio: sposta da "da cercare" a libreria
  const wishFoundMatch = pathname.match(/^\/api\/wishlist\/(\d+)\/trovato$/);
  if (wishFoundMatch && method === 'POST') {
    const wish = await env.DB.prepare('SELECT * FROM wishlist WHERE id = ?').bind(wishFoundMatch[1]).first();
    if (!wish) return json({ error: 'non trovato' }, 404);
    if (wish.added_by !== sessionUser.username) return json({ error: 'non è tuo' }, 403);
    const b = await request.json().catch(() => ({}));
    const palette = ['#201e1d', '#1440d8', '#8ba2ff', '#bab6b6', '#d7d3d3', '#0d1a45'];
    const result = await env.DB.prepare(
      `INSERT INTO album (artist, title, condition_media, value_estimate, notes, cover_color, added_by) VALUES (?,?,?,?,?,?,?)`
    ).bind(wish.artist, wish.title, b.condition_media || 'VG', b.value_estimate || null, wish.note || null,
      palette[Math.floor(Math.random() * palette.length)], sessionUser.username).run();
    await env.DB.prepare('DELETE FROM wishlist WHERE id = ?').bind(wishFoundMatch[1]).run();
    return json({ ok: true, id: result.meta.last_row_id });
  }

  // --- suggerimento di valore per una condizione specifica ---

  if (pathname === '/api/valore' && method === 'POST') {
    const b = await request.json().catch(() => null);
    if (!b || !b.discogs_release_id || !b.condition_media) return json({ error: 'dati mancanti' }, 400);
    const suggestion = await discogsPriceSuggestion(env, b.discogs_release_id, b.condition_media);
    return json({ suggestion });
  }

  // --- statistiche della collezione ---

  if (pathname === '/api/stats' && method === 'GET') {
    const { results: albums } = await env.DB.prepare('SELECT year, condition_media, value_estimate, added_at FROM album WHERE added_by = ?').bind(sessionUser.username).all();
    const count = albums.length;
    const totalValue = albums.reduce((s, a) => s + (a.value_estimate || 0), 0);

    const buckets = { mint_nm: 0, vgplus: 0, vg: 0, good: 0, fair_poor: 0 };
    let weightSum = 0, weightCount = 0;
    for (const a of albums) {
      const code = CONDITION_ORDER.includes(a.condition_media) ? a.condition_media : 'VG';
      buckets[conditionBucket(code)]++;
      weightSum += CONDITION_WEIGHT[code] || CONDITION_WEIGHT.VG;
      weightCount++;
    }
    const avgWeight = weightCount ? Math.round(weightSum / weightCount) : CONDITION_WEIGHT.VG;
    const avgCondition = CONDITION_ORDER.find(c => CONDITION_WEIGHT[c] === avgWeight) || 'VG';

    const decades = {};
    for (const a of albums) {
      if (!a.year) continue;
      const d = Math.floor(a.year / 10) * 10;
      decades[d] = (decades[d] || 0) + 1;
    }

    const sorted = [...albums].filter(a => a.added_at).sort((a, b) => a.added_at.localeCompare(b.added_at));
    let cumulative = 0;
    const valueOverTime = sorted.map(a => { cumulative += a.value_estimate || 0; return { date: a.added_at, value: Math.round(cumulative) }; });

    return json({
      count, total_value: Math.round(totalValue), avg_condition: avgCondition,
      buckets, decades, value_over_time: valueOverTime,
    });
  }

  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/api/')) return handleApi(request, env, pathname, request.method);

    // Assets sempre serviti (necessari anche prima del login / da desktop, per il flusso di installazione)
    if (
      pathname.startsWith('/assets/') ||
      pathname === '/manifest.json' ||
      pathname === '/sw.js'
    ) {
      return env.ASSETS.fetch(request);
    }

    // App pensata solo per telefono, installata: da desktop mostriamo l'avviso,
    // ma chi ha già scelto "Continua comunque" (cookie desktop_ok) passa oltre.
    if (!isMobileUA(request) && !hasDesktopOverride(request) && pathname !== '/install.html') {
      return env.ASSETS.fetch(new Request(new URL('/install.html', request.url), request));
    }

    if (PUBLIC_PAGES.has(pathname)) return env.ASSETS.fetch(request);

    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) return Response.redirect(new URL('/login.html', request.url), 302);

    if (pathname === '/') return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));

    if (ADMIN_ONLY_PAGES.has(pathname) && sessionUser.role !== 'Amministratore') {
      return Response.redirect(new URL('/index.html', request.url), 302);
    }

    return env.ASSETS.fetch(request);
  }
};
