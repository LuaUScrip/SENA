// NOX API - Cloudflare Worker + D1
// Speaks the same protocol the NOX library (libnoxuy.txt) expects:
//   /key/check  /sync  /chat/send  /dm/send  /vstate  /egg/latest
// plus /public/* for the website and /admin/* for the admin panel.

const TIERS = ["VIP", "DONATOR", "PARTNER", "CONTENT CREATOR", "ADMIN", "NOX WIFE", "OWNER", "TRIAL"];
const ROLES = TIERS.filter((t) => t !== "TRIAL");   // ranks you can give straight to a player
const ONLINE_WINDOW = 45;       // seconds without /sync before a player counts as offline
const VSTATE_WINDOW = 20;
const CHAT_TTL = 1800;
const CHAT_MAX = 200;
const POLL = 5;           // seconds between player syncs (higher = fewer requests on the free plan)
const KEY_RE = /NOX-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+/i;

const now = () => Math.floor(Date.now() / 1000);

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

const RESERVED_NAME = /(^|[^a-z])(owner|admin|staff|mod|moderator|nox)([^a-z]|$)/i;

function cors(env, req) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = req.headers.get("Origin") || "";
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? (allowed.includes("*") ? "*" : origin) : allowed[0],
    "access-control-allow-headers": "content-type, x-admin-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  };
}

function newKey() {
  const part = () => {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  return `NOX-${part()}-${part()}-${part()}`;
}

function cleanKey(k) {
  return String(k || "").replace(/\s+/g, "").toUpperCase();
}

function tierFor(row) {
  return row.tier === "TRIAL" ? "trial" : "donator";
}

function licenseState(row, t = now()) {
  if (!row) return "invalid";
  if (row.revoked) return "revoked";
  if (row.expires && row.expires < t) return "expired";
  return "valid";
}

function daysLeft(row, t = now()) {
  return row.expires ? Math.max(0, Math.ceil((row.expires - t) / 86400)) : 9999;
}

async function getSetting(env, k, fallback = "") {
  const r = await env.DB.prepare("SELECT v FROM settings WHERE k = ?").bind(k).first();
  return r ? r.v : fallback;
}

async function setSetting(env, k, v) {
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .bind(k, String(v)).run();
}

function clientKeyOk(env, key) {
  return !!env.CLIENT_KEY && key === env.CLIENT_KEY;
}

function adminOk(env, req) {
  const t = req.headers.get("X-Admin-Token") || "";
  if (!env.ADMIN_TOKEN || t.length !== env.ADMIN_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < t.length; i++) diff |= t.charCodeAt(i) ^ env.ADMIN_TOKEN.charCodeAt(i);
  return diff === 0;
}

function ownerUids(env) {
  return new Set((env.OWNER_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean));
}

// ---------------------------------------------------------------- game client

async function keyCheck(env, q) {
  if (!clientKeyOk(env, q.get("key"))) return json({ ok: false, error: "bad_key" }, 403);
  const license = cleanKey(q.get("license"));
  const hwid = (q.get("hwid") || "").trim();
  const uid = (q.get("uid") || "").trim();
  const reply = (valid, reason, extra = {}) => json({ ok: true, valid, ...(reason ? { reason } : {}), ...extra });

  if (!license || !hwid) return reply(false, "invalid");
  const ban = await env.DB.prepare("SELECT 1 FROM bans WHERE uid = ?").bind(uid).first();
  if (ban) return reply(false, "revoked");

  const row = await env.DB.prepare("SELECT * FROM licenses WHERE key = ?").bind(license).first();
  const state = licenseState(row);
  if (state !== "valid") return reply(false, state);

  const known = await env.DB.prepare("SELECT 1 FROM hwids WHERE key = ? AND hwid = ?").bind(license, hwid).first();
  if (!known) {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM hwids WHERE key = ?").bind(license).first();
    if (n >= row.max_hwid) return reply(false, "hwid limit");
    await env.DB.prepare("INSERT INTO hwids (key, hwid, uid, first_seen) VALUES (?, ?, ?, ?)")
      .bind(license, hwid, uid, now()).run();
  }

  const tier = tierFor(row);
  return reply(true, null, {
    tier,
    is_trial: tier === "trial",
    is_donator: tier === "donator",
    label: row.tier,
    name: row.tier,
    days_left: daysLeft(row),
    expires: row.expires || 0,
  });
}

async function sync(env, q) {
  if (!clientKeyOk(env, q.get("key"))) return json({ ok: false, error: "bad_key" }, 403);
  const uid = (q.get("uid") || "").trim();
  if (!uid || uid === "0") return json({ ok: false, error: "no_uid" });
  const t = now();
  const name = (q.get("name") || "").slice(0, 40);

  const ban = await env.DB.prepare("SELECT reason FROM bans WHERE uid = ?").bind(uid).first();
  if (ban) {
    return json({ ok: true, blacklisted: true, kick: ban.reason ? `Blacklisted from NOX: ${ban.reason}` : "" });
  }

  const lic = cleanKey(q.get("lic"));
  const row = lic ? await env.DB.prepare("SELECT * FROM licenses WHERE key = ?").bind(lic).first() : null;
  const isOwner = ownerUids(env).has(uid);   // owner accounts never need a key
  let grant = await env.DB.prepare("SELECT * FROM roles WHERE uid = ?").bind(uid).first();
  if (grant && grant.expires && grant.expires < t) grant = null;
  const granted = isOwner || !!grant;        // a role given from the admin panel also needs no key
  const state = granted ? "valid" : !lic ? "none" : licenseState(row, t) === "valid" ? "valid" : "invalid";
  const tier = granted ? "donator" : state === "valid" ? tierFor(row) : "free";
  const label = isOwner ? "OWNER" : grant ? grant.role : state === "valid" ? row.tier : "FREE";

  await env.DB.prepare(
    `INSERT INTO presence (uid, name, display, tier, game, place, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET name = excluded.name, display = excluded.display, tier = excluded.tier,
       game = excluded.game, place = excluded.place, last_seen = excluded.last_seen`
  ).bind(uid, name, (q.get("display") || "").slice(0, 40), label,
    (q.get("game") || "").slice(0, 60), q.get("place") || "", t).run();

  const chatSince = parseInt(q.get("chat_since") || "0", 10) || 0;
  const annSince = parseInt(q.get("ann_since") || "-1", 10);
  const dmSince = parseInt(q.get("dm_since") || "0", 10) || 0;

  const chatRows = chatSince > 0
    ? await env.DB.prepare("SELECT * FROM chat WHERE id > ? AND room = 'global' AND ts > ? ORDER BY id LIMIT 40")
        .bind(chatSince, t - CHAT_TTL).all()
    : await env.DB.prepare("SELECT * FROM (SELECT * FROM chat WHERE room = 'global' AND ts > ? ORDER BY id DESC LIMIT 25) ORDER BY id")
        .bind(t - CHAT_TTL).all();

  const annMax = (await env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM announcements").first()).m;
  const annRows = annSince >= 0
    ? await env.DB.prepare("SELECT * FROM announcements WHERE id > ? ORDER BY id LIMIT 5").bind(annSince).all()
    : { results: [] };

  const dmRows = await env.DB.prepare("SELECT * FROM dms WHERE id > ? AND lower(to_name) = lower(?) ORDER BY id LIMIT 20")
    .bind(dmSince, name).all();
  const dmMax = (await env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM dms").first()).m;

  const online = (await env.DB.prepare("SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?")
    .bind(t - ONLINE_WINDOW).first()).n;

  const chatPaused = (await getSetting(env, "chat_paused", "0")) === "1";
  const chatPauseMsg = await getSetting(env, "chat_pause_msg", "");

  return json({
    ok: true,
    online,
    tier,
    label,
    is_donator: tier === "donator",
    is_trial: tier === "trial",
    lic_state: state,
    poll: POLL,
    chat_ttl: CHAT_TTL,
    chat_max: CHAT_MAX,
    chat: chatRows.results.map((m) => ({
      id: m.id, ts: m.ts, uid: m.uid, name: m.name, text: m.text,
      owner: !!m.owner, donator: m.tier !== "FREE", tier: m.tier, av: m.uid,
    })),
    ann_seq: annMax,
    ann: annRows.results.map((a) => ({
      id: a.id, title: a.title, text: a.text, duration: a.duration, sound: a.sound || undefined,
      from: a.author || "NOX", role: a.role || undefined,
    })),
    dm_seq: dmMax,
    dm: dmRows.results.map((d) => ({ id: d.id, ts: d.ts, uid: d.from_uid, name: d.from_name, text: d.text })),
    join_seq: 0,
    joins: [],
    chat_paused: chatPaused,
    chat_pause_dm: false,
    chat_pause_msg: chatPauseMsg,
    forum_paused: true,
    forum_pause_msg: "Forum is not available yet.",
  });
}

async function chatSend(env, q) {
  if (!clientKeyOk(env, q.get("key"))) return json({ ok: false, error: "bad_key" }, 403);
  const uid = (q.get("uid") || "").trim();
  const text = (q.get("text") || "").replace(/[\r\n]+/g, " ").trim();
  if (!uid || !text) return json({ ok: false, error: "empty" });
  if (text.length > 200) return json({ ok: false, error: "too_long" });
  const t = now();

  const user = await env.DB.prepare("SELECT * FROM presence WHERE uid = ?").bind(uid).first();
  if (!user || user.last_seen < t - 300) return json({ ok: false, error: "not_synced" });
  if (await env.DB.prepare("SELECT 1 FROM bans WHERE uid = ?").bind(uid).first()) return json({ ok: false, error: "banned" });
  if ((await getSetting(env, "chat_paused", "0")) === "1") {
    return json({ ok: false, error: "paused", message: await getSetting(env, "chat_pause_msg", "") });
  }
  if (user.last_chat && t - user.last_chat < 2) return json({ ok: false, error: "slow_down" });
  if (KEY_RE.test(text)) return json({ ok: false, error: "key_share" });

  const bad = (await getSetting(env, "badwords", "")).split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const lower = text.toLowerCase();
  const hit = bad.find((w) => lower.includes(w));
  if (hit) return json({ ok: false, error: "badword:" + hit });

  const isOwner = ownerUids(env).has(uid);
  const tier = isOwner ? "OWNER" : user.tier || "FREE";
  const name = isOwner ? "NOX" : user.name || "player";

  await env.DB.prepare("UPDATE presence SET last_chat = ? WHERE uid = ?").bind(t, uid).run();
  await env.DB.prepare("INSERT INTO chat (ts, uid, name, text, tier, owner, room) VALUES (?, ?, ?, ?, ?, ?, 'global')")
    .bind(t, uid, name, text, tier, isOwner ? 1 : 0).run();
  // keep the table small
  await env.DB.prepare("DELETE FROM chat WHERE ts < ?").bind(t - CHAT_TTL * 4).run();
  return json({ ok: true });
}

async function dmSend(env, q) {
  if (!clientKeyOk(env, q.get("key"))) return json({ ok: false, error: "bad_key" }, 403);
  const uid = (q.get("uid") || "").trim();
  const to = (q.get("to") || "").trim();
  const text = (q.get("text") || "").replace(/[\r\n]+/g, " ").trim();
  if (!uid || !to || !text) return json({ ok: false, error: "empty" });
  if (text.length > 200) return json({ ok: false, error: "too_long" });
  const user = await env.DB.prepare("SELECT * FROM presence WHERE uid = ?").bind(uid).first();
  if (!user || user.last_seen < now() - 300) return json({ ok: false, error: "not_synced" });
  const target = await env.DB.prepare("SELECT 1 FROM presence WHERE lower(name) = lower(?)").bind(to).first();
  if (!target) return json({ ok: false, error: "user_not_found" });
  if (KEY_RE.test(text)) return json({ ok: false, error: "key_share" });
  await env.DB.prepare("INSERT INTO dms (ts, from_uid, from_name, to_name, text) VALUES (?, ?, ?, ?, ?)")
    .bind(now(), uid, user.name, to, text).run();
  return json({ ok: true });
}

async function vstate(env, q) {
  if (!clientKeyOk(env, q.get("key"))) return json({ ok: false, error: "bad_key" }, 403);
  const job = (q.get("job") || "").slice(0, 80);
  const uid = (q.get("uid") || "").trim();
  if (!job || !uid) return json({ ok: false, error: "bad_request" });
  const t = now();
  await env.DB.prepare(
    `INSERT INTO vstate (job, uid, held, back, ts) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(job, uid) DO UPDATE SET held = excluded.held, back = excluded.back, ts = excluded.ts`
  ).bind(job, uid, (q.get("held") || "").slice(0, 120), (q.get("back") || "").slice(0, 120), t).run();
  const rows = await env.DB.prepare("SELECT uid, held, back FROM vstate WHERE job = ? AND uid != ? AND ts > ?")
    .bind(job, uid, t - VSTATE_WINDOW).all();
  const players = {};
  for (const r of rows.results) players[r.uid] = { held: r.held, back: r.back };
  await env.DB.prepare("DELETE FROM vstate WHERE ts < ?").bind(t - 300).run();
  return json({ ok: true, poll: 4, players });
}

// ------------------------------------------------------------------- website

async function publicStats(env) {
  const t = now();
  const online = (await env.DB.prepare("SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?").bind(t - ONLINE_WINDOW).first()).n;
  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM presence").first()).n;
  return json({ ok: true, online, total_seen: total, time: t });
}

async function publicAnnouncements(env) {
  const rows = await env.DB.prepare("SELECT id, ts, title, text, author, role FROM announcements ORDER BY id DESC LIMIT 10").all();
  return json({ ok: true, items: rows.results });
}

async function publicLicense(env, q) {
  const key = cleanKey(q.get("key"));
  if (!key) return json({ ok: false, error: "empty" });
  const row = await env.DB.prepare("SELECT * FROM licenses WHERE key = ?").bind(key).first();
  if (!row) return json({ ok: true, found: false });
  const used = (await env.DB.prepare("SELECT COUNT(*) AS n FROM hwids WHERE key = ?").bind(key).first()).n;
  return json({
    ok: true, found: true, state: licenseState(row), status: row.tier,
    days_left: daysLeft(row), expires: row.expires || 0, devices_used: used, devices_max: row.max_hwid,
  });
}

// ------------------------------------------------------- comments and games

async function ipHash(env, req) {
  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "unknown";
  const data = new TextEncoder().encode(ip + "|" + (env.ADMIN_TOKEN || "nox"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function publicComments(env, q) {
  const limit = Math.min(Math.max(parseInt(q.get("limit") || "60", 10) || 60, 1), 100);
  const rows = await env.DB.prepare(
    "SELECT id, ts, name, text, role, verified, pinned FROM site_comments ORDER BY pinned DESC, id DESC LIMIT ?"
  ).bind(limit).all();
  return json({ ok: true, items: rows.results });
}

async function postComment(env, req) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").replace(/\s+/g, " ").trim();
  const text = String(body.text || "").replace(/[\u0000-\u0009\u000b-\u001f]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (name.length < 2 || name.length > 24 || !/^[A-Za-z0-9 _.\-]+$/.test(name)) return json({ ok: false, error: "bad_name" });
  if (text.length < 2 || text.length > 500) return json({ ok: false, error: "bad_text" });
  if (KEY_RE.test(text)) return json({ ok: false, error: "key_share" });

  let role = "GUEST";
  let verified = 0;
  const key = cleanKey(body.key);
  if (key) {
    const row = await env.DB.prepare("SELECT * FROM licenses WHERE key = ?").bind(key).first();
    if (licenseState(row) !== "valid") return json({ ok: false, error: "invalid_key" });
    role = row.tier;
    verified = 1;
  } else if (RESERVED_NAME.test(name)) {
    return json({ ok: false, error: "reserved_name" });
  }

  const bad = (await getSetting(env, "badwords", "")).split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const lower = (name + " " + text).toLowerCase();
  if (bad.some((w) => lower.includes(w))) return json({ ok: false, error: "badword" });

  const ip = await ipHash(env, req);
  const t = now();
  const recent = await env.DB.prepare("SELECT 1 FROM site_comments WHERE ip = ? AND ts > ?").bind(ip, t - 20).first();
  if (recent) return json({ ok: false, error: "slow_down" });

  await env.DB.prepare("INSERT INTO site_comments (ts, name, text, role, verified, ip) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(t, name, text, role, verified, ip).run();
  return json({ ok: true, role, verified: !!verified });
}

async function publicGame(env, q) {
  let universe = (q.get("universe") || "").replace(/\D/g, "");
  const place = (q.get("place") || "").replace(/\D/g, "");
  const get = async (url) => {
    const r = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!r.ok) throw new Error("upstream " + r.status);
    return r.json();
  };
  try {
    if (!universe && place) {
      universe = String((await get(`https://apis.roblox.com/universes/v1/places/${place}/universe`)).universeId || "");
    }
    if (!universe) return json({ ok: false, error: "not_found" });
    const [info, icon, shots] = await Promise.all([
      get(`https://games.roblox.com/v1/games?universeIds=${universe}`),
      get(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universe}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`),
      get(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universe}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`),
    ]);
    const g = info.data && info.data[0];
    if (!g) return json({ ok: false, error: "not_found" });
    return json({
      ok: true, universeId: universe, placeId: g.rootPlaceId, name: g.name, playing: g.playing, visits: g.visits, updated: g.updated || "",
      icon: (icon.data && icon.data[0] && icon.data[0].imageUrl) || "",
      banner: (shots.data && shots.data[0] && shots.data[0].thumbnails && shots.data[0].thumbnails[0] && shots.data[0].thumbnails[0].imageUrl) || "",
    }, 200, { "cache-control": "public, max-age=300" });
  } catch (e) {
    return json({ ok: false, error: "upstream" }, 502);
  }
}

// --------------------------------------------------------------------- admin

const MUTATING = new Set([
  "/admin/license/create", "/admin/license/revoke", "/admin/license/resethwid", "/admin/license/extend",
  "/admin/announce", "/admin/announce/delete", "/admin/ban", "/admin/unban", "/admin/chat/pause", "/admin/badwords",
  "/admin/chat/delete", "/admin/comments/delete", "/admin/comments/pin", "/admin/comments/post",
  "/admin/roles/set", "/admin/roles/remove",
]);

function summarize(body) {
  const parts = [];
  for (const k of ["tier", "role", "uid", "name", "days", "count", "id", "title", "paused", "pinned"]) {
    if (body[k] !== undefined && body[k] !== "") parts.push(`${k}=${String(body[k]).slice(0, 40)}`);
  }
  if (body.key) parts.push(`key=...${String(body.key).slice(-6)}`);
  return parts.join(" ");
}

async function admin(env, req, path) {
  if (!adminOk(env, req)) return json({ ok: false, error: "forbidden" }, 403);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const res = await adminRoute(env, path, body);
  if (MUTATING.has(path) && res.status === 200) {
    const out = await res.clone().json().catch(() => null);
    if (out && out.ok) {
      await env.DB.prepare("INSERT INTO audit (ts, action, detail) VALUES (?, ?, ?)")
        .bind(now(), path.replace("/admin/", ""), summarize(body)).run();
      await env.DB.prepare("DELETE FROM audit WHERE ts < ?").bind(now() - 90 * 86400).run();
    }
  }
  return res;
}

async function adminRoute(env, path, body) {
  const t = now();

  if (path === "/admin/stats") {
    const online = (await env.DB.prepare("SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?").bind(t - ONLINE_WINDOW).first()).n;
    const licenses = (await env.DB.prepare("SELECT COUNT(*) AS n FROM licenses").first()).n;
    const bans = (await env.DB.prepare("SELECT COUNT(*) AS n FROM bans").first()).n;
    return json({
      ok: true, online, licenses, bans,
      chat_paused: (await getSetting(env, "chat_paused", "0")) === "1",
      chat_pause_msg: await getSetting(env, "chat_pause_msg", ""),
      badwords: await getSetting(env, "badwords", ""),
    });
  }

  if (path === "/admin/license/create") {
    const tier = String(body.tier || "").toUpperCase();
    if (!TIERS.includes(tier)) return json({ ok: false, error: "bad_tier", tiers: TIERS });
    const count = Math.min(Math.max(parseInt(body.count || 1, 10) || 1, 1), 50);
    const days = parseInt(body.days || 0, 10) || 0;
    const maxHwid = Math.min(Math.max(parseInt(body.max_hwid || 3, 10) || 3, 1), 10);
    const keys = [];
    for (let i = 0; i < count; i++) {
      const key = newKey();
      await env.DB.prepare(
        "INSERT INTO licenses (key, tier, note, discord_id, created, expires, max_hwid) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(key, tier, String(body.note || "").slice(0, 120), String(body.discord_id || ""), t,
        days > 0 ? t + days * 86400 : 0, maxHwid).run();
      keys.push(key);
    }
    return json({ ok: true, keys, tier, days });
  }

  if (path === "/admin/license/list") {
    const rows = await env.DB.prepare(
      `SELECT l.key, l.tier, l.note, l.discord_id, l.created, l.expires, l.revoked, l.max_hwid,
              (SELECT COUNT(*) FROM hwids h WHERE h.key = l.key) AS devices
       FROM licenses l ORDER BY l.created DESC LIMIT 200`
    ).all();
    return json({ ok: true, items: rows.results });
  }

  if (path === "/admin/license/revoke") {
    const r = await env.DB.prepare("UPDATE licenses SET revoked = ? WHERE key = ?")
      .bind(body.undo ? 0 : 1, cleanKey(body.key)).run();
    return json({ ok: true, changed: r.meta?.changes ?? 0 });
  }

  if (path === "/admin/license/resethwid") {
    await env.DB.prepare("DELETE FROM hwids WHERE key = ?").bind(cleanKey(body.key)).run();
    await env.DB.prepare("UPDATE licenses SET last_reset = ? WHERE key = ?").bind(t, cleanKey(body.key)).run();
    return json({ ok: true });
  }

  if (path === "/admin/announce") {
    const title = String(body.title || "").slice(0, 80);
    const text = String(body.text || "").slice(0, 400);
    if (!title || !text) return json({ ok: false, error: "empty" });
    await env.DB.prepare("INSERT INTO announcements (ts, title, text, duration, author, role) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(t, title, text, Math.min(Math.max(parseInt(body.duration || 15, 10) || 15, 5), 60),
        String(body.author || "NOX").slice(0, 40), String(body.role || "").slice(0, 40)).run();
    return json({ ok: true });
  }

  if (path === "/admin/announce/delete") {
    await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(parseInt(body.id, 10) || 0).run();
    return json({ ok: true });
  }

  if (path === "/admin/ban") {
    const uid = String(body.uid || "").trim();
    if (!uid) return json({ ok: false, error: "empty" });
    await env.DB.prepare("INSERT INTO bans (uid, reason, ts) VALUES (?, ?, ?) ON CONFLICT(uid) DO UPDATE SET reason = excluded.reason")
      .bind(uid, String(body.reason || "").slice(0, 120), t).run();
    return json({ ok: true });
  }

  if (path === "/admin/unban") {
    await env.DB.prepare("DELETE FROM bans WHERE uid = ?").bind(String(body.uid || "").trim()).run();
    return json({ ok: true });
  }

  if (path === "/admin/bans") {
    const rows = await env.DB.prepare("SELECT * FROM bans ORDER BY ts DESC LIMIT 200").all();
    return json({ ok: true, items: rows.results });
  }

  if (path === "/admin/chat/pause") {
    await setSetting(env, "chat_paused", body.paused ? "1" : "0");
    await setSetting(env, "chat_pause_msg", String(body.message || "").slice(0, 160));
    return json({ ok: true });
  }

  if (path === "/admin/badwords") {
    await setSetting(env, "badwords", String(body.words || "").slice(0, 2000));
    return json({ ok: true });
  }

  if (path === "/admin/chat/recent") {
    const rows = await env.DB.prepare("SELECT * FROM chat ORDER BY id DESC LIMIT 60").all();
    return json({ ok: true, items: rows.results });
  }

  if (path === "/admin/chat/delete") {
    await env.DB.prepare("DELETE FROM chat WHERE id = ?").bind(parseInt(body.id, 10) || 0).run();
    return json({ ok: true });
  }

  if (path === "/admin/license/extend") {
    const days = Math.min(Math.max(parseInt(body.days || 0, 10) || 0, 1), 3650);
    const key = cleanKey(body.key);
    const row = await env.DB.prepare("SELECT expires FROM licenses WHERE key = ?").bind(key).first();
    if (!row) return json({ ok: false, error: "not_found" });
    if (!row.expires) return json({ ok: false, error: "no_expiry" });   // already permanent
    const from = row.expires > t ? row.expires : t;
    await env.DB.prepare("UPDATE licenses SET expires = ? WHERE key = ?").bind(from + days * 86400, key).run();
    return json({ ok: true });
  }

  if (path === "/admin/players") {
    const q = String(body.q || "").trim().toLowerCase();
    const onlySeen = !!body.all;
    const like = `%${q}%`;
    const rows = await env.DB.prepare(
      `SELECT uid, name, display, tier, game, place, last_seen FROM presence
       WHERE (? = 1 OR last_seen > ?) AND (? = '' OR lower(name) LIKE ? OR lower(display) LIKE ? OR uid = ?)
       ORDER BY last_seen DESC LIMIT 300`
    ).bind(onlySeen ? 1 : 0, t - ONLINE_WINDOW - 20, q, like, like, q).all();
    const online = (await env.DB.prepare("SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?").bind(t - ONLINE_WINDOW - 20).first()).n;
    return json({ ok: true, online, now: t, items: rows.results });
  }

  if (path === "/admin/roles/list") {
    const rows = await env.DB.prepare(
      `SELECT r.uid, r.name, r.role, r.expires, r.note, r.created, p.name AS seen_name, p.last_seen
       FROM roles r LEFT JOIN presence p ON p.uid = r.uid ORDER BY r.created DESC LIMIT 300`
    ).all();
    return json({ ok: true, roles: ROLES, items: rows.results });
  }

  if (path === "/admin/roles/set") {
    const uid = String(body.uid || "").trim();
    const role = String(body.role || "").toUpperCase();
    if (!/^\d{1,20}$/.test(uid)) return json({ ok: false, error: "bad_uid" });
    if (!ROLES.includes(role)) return json({ ok: false, error: "bad_role", roles: ROLES });
    const days = parseInt(body.days || 0, 10) || 0;
    await env.DB.prepare(
      `INSERT INTO roles (uid, name, role, expires, note, created) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET name = excluded.name, role = excluded.role, expires = excluded.expires, note = excluded.note`
    ).bind(uid, String(body.name || "").slice(0, 40), role, days > 0 ? t + days * 86400 : 0, String(body.note || "").slice(0, 120), t).run();
    return json({ ok: true });
  }

  if (path === "/admin/roles/remove") {
    await env.DB.prepare("DELETE FROM roles WHERE uid = ?").bind(String(body.uid || "").trim()).run();
    return json({ ok: true });
  }

  if (path === "/admin/audit") {
    const rows = await env.DB.prepare("SELECT id, ts, action, detail FROM audit ORDER BY id DESC LIMIT 100").all();
    return json({ ok: true, items: rows.results });
  }

  if (path === "/admin/comments/list") {
    const rows = await env.DB.prepare("SELECT id, ts, name, text, role, verified, pinned FROM site_comments ORDER BY id DESC LIMIT 100").all();
    return json({ ok: true, items: rows.results });
  }

  if (path === "/admin/comments/delete") {
    await env.DB.prepare("DELETE FROM site_comments WHERE id = ?").bind(parseInt(body.id, 10) || 0).run();
    return json({ ok: true });
  }

  if (path === "/admin/comments/pin") {
    await env.DB.prepare("UPDATE site_comments SET pinned = ? WHERE id = ?").bind(body.pinned ? 1 : 0, parseInt(body.id, 10) || 0).run();
    return json({ ok: true });
  }

  if (path === "/admin/comments/post") {
    const name = String(body.name || "NOX").slice(0, 24);
    const text = String(body.text || "").trim().slice(0, 500);
    const role = String(body.role || "OWNER").toUpperCase().slice(0, 20);
    if (!text) return json({ ok: false, error: "empty" });
    await env.DB.prepare("INSERT INTO site_comments (ts, name, text, role, verified, pinned) VALUES (?, ?, ?, ?, 1, ?)")
      .bind(t, name, text, role, body.pinned ? 1 : 0).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: "not_found" }, 404);
}

// -------------------------------------------------------------------- router

export default {
  async fetch(req, env) {
    const headers = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const q = url.searchParams;

    let res;
    try {
      if (path === "/") res = json({ ok: true, service: "nox-api" });
      else if (path === "/key/check") res = await keyCheck(env, q);
      else if (path === "/sync") res = await sync(env, q);
      else if (path === "/chat/send") res = await chatSend(env, q);
      else if (path === "/dm/send") res = await dmSend(env, q);
      else if (path === "/vstate") res = await vstate(env, q);
      else if (path === "/egg/latest") {
        res = clientKeyOk(env, q.get("key")) ? json({ ok: true, recent_spawns: [] }) : json({ ok: false, error: "bad_key" }, 403);
      }
      else if (path === "/public/stats") res = await publicStats(env);
      else if (path === "/public/announcements") res = await publicAnnouncements(env);
      else if (path === "/public/license") res = await publicLicense(env, q);
      else if (path === "/public/comments") res = await publicComments(env, q);
      else if (path === "/public/comment" && req.method === "POST") res = await postComment(env, req);
      else if (path === "/public/game") res = await publicGame(env, q);
      else if (path.startsWith("/admin/")) res = await admin(env, req, path);
      else res = json({ ok: false, error: "not_found" }, 404);
    } catch (err) {
      res = json({ ok: false, error: "server_error" }, 500);
    }

    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    return out;
  },
};
