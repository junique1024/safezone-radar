// 세이프존 레이더 — 방(room) 단위 상태 중계 API
// GET  /api/state?room=AB12        → { state, ts, store }
// POST /api/state?room=AB12  {state} → { ok, ts, store }
// Upstash Redis(Vercel Marketplace) 환경변수가 있으면 Redis에 저장하고,
// 없으면 함수 인스턴스 메모리에 저장한다(시연용 간이 모드: 인스턴스가 바뀌면 초기화될 수 있음).

const TTL_SEC = 6 * 60 * 60;
const MAX_BYTES = 16 * 1024;
const ROOM_RE = /^[A-Z0-9]{4,8}$/;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const useRedis = !!(REDIS_URL && REDIS_TOKEN);

const mem = globalThis.__szrMem || (globalThis.__szrMem = new Map());

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

async function getRoom(room) {
  if (useRedis) {
    const raw = await redis(["GET", "szr:" + room]);
    return raw ? JSON.parse(raw) : null;
  }
  const e = mem.get(room);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_SEC * 1000) { mem.delete(room); return null; }
  return e;
}

async function setRoom(room, entry) {
  if (useRedis) { await redis(["SET", "szr:" + room, JSON.stringify(entry), "EX", TTL_SEC]); return; }
  mem.set(room, entry);
  if (mem.size > 500) { const oldest = [...mem.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]; mem.delete(oldest[0]); }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BYTES) throw new Error("too large"); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  const url = new URL(req.url, "http://x");
  const room = String(url.searchParams.get("room") || "").toUpperCase();
  const send = (code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); };
  if (!ROOM_RE.test(room)) return send(400, { error: "room 코드가 올바르지 않습니다" });
  const store = useRedis ? "redis" : "memory";

  try {
    if (req.method === "GET") {
      const e = await getRoom(room);
      return send(200, { state: e ? e.state : null, ts: e ? e.ts : 0, store });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const state = body && body.state;
      if (!state || typeof state !== "object" || typeof state.zones !== "object") return send(400, { error: "state 형식 오류" });
      const raw = JSON.stringify(state);
      if (raw.length > MAX_BYTES) return send(413, { error: "state가 너무 큽니다" });
      const entry = { state, ts: Date.now() };
      await setRoom(room, entry);
      return send(200, { ok: true, ts: entry.ts, store });
    }
    return send(405, { error: "GET 또는 POST만 지원합니다" });
  } catch (err) {
    return send(500, { error: "저장소 오류", detail: String(err && err.message || err) });
  }
}
