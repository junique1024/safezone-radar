"use strict";
// 세이프존 레이더 v2 — Vercel 배포판
// 운영자 화면(관제) + 관중 화면(#fan) · /api/state 로 방(room) 단위 실시간 중계

// ================= Config =================
const LV = [
  { key: "ok", name: "정상", c: "var(--ok)", s: "var(--ok-soft)" },
  { key: "caution", name: "주의", c: "var(--caution)", s: "var(--caution-soft)" },
  { key: "warn", name: "경고", c: "var(--warn)", s: "var(--warn-soft)" },
  { key: "danger", name: "위험", c: "var(--danger)", s: "var(--danger-soft)" },
];
// 지역 특보 비교용(기상청 체감온도 기준 단순 비교): 33℃ 주의보 수준, 35℃ 경보 수준
const REG = [
  { name: "특보 기준 미만", c: "var(--muted)", s: "var(--soft)" },
  { name: "폭염주의보 수준", c: "var(--caution)", s: "var(--caution-soft)" },
  { name: "폭염경보 수준", c: "var(--warn)", s: "var(--warn-soft)" },
];
// 기본 기준값(℃ WBGT): 26·28은 FIFPRO 권고 참고, 30은 내부 임시값. 취약 선수군은 2℃ 낮춤(임시값)
const DEFAULT_TH = { caution: 26, warn: 28, danger: 30, vuln: 2 };
// 구역: off = 기준 대비 보정값(가정, 파일럿 실측으로 교체). 위치 정보는 예시
const ZONES = [
  { id: "Z1", name: "본부석", tag: "지붕 그늘", off: -2.0, kind: "crowd", shade: "본부석 뒤 실내 로비", water: "본부석 1층 급수대", aed: "본부석 출입구 B 옆", x: 20, y: 150, w: 72, h: 120 },
  { id: "Z2", name: "서측 일반석", tag: "오후 그늘 일부", off: -0.5, kind: "crowd", shade: "서측 2층 복도", water: "서측 매점 옆 급수대", aed: "서측 출입구 A 옆", x: 20, y: 20, w: 72, h: 120 },
  { id: "Z3", name: "북측 스탠드", tag: "개방형", off: 0.0, kind: "crowd", shade: "북측 출입구 그늘막", water: "북측 매점 옆 급수대", aed: "북측 출입구 옆", x: 110, y: 20, w: 380, h: 62 },
  { id: "Z4", name: "동측 A", tag: "서향 직사광", off: 2.0, kind: "crowd", shade: "동측 지하 통로", water: "동측 A 계단 아래 급수대", aed: "동측 의무실", x: 508, y: 20, w: 72, h: 185 },
  { id: "Z5", name: "동측 B", tag: "직사광", off: 1.5, kind: "crowd", shade: "동측 지하 통로", water: "동측 B 매점 옆 급수대", aed: "동측 의무실", x: 508, y: 215, w: 72, h: 185 },
  { id: "Z6", name: "남측 스탠드", tag: "개방형", off: 0.5, kind: "crowd", shade: "남측 출입구 그늘막", water: "남측 매점 옆 급수대", aed: "남측 출입구 옆", x: 110, y: 338, w: 380, h: 62 },
  { id: "F1", name: "그라운드", tag: "인조잔디", off: 2.5, kind: "athlete", shade: "선수 대기실", water: "벤치 냉장 급수", aed: "본부석 의무실", x: 110, y: 100, w: 380, h: 220 },
  { id: "F2", name: "선수 대기석", tag: "벤치", off: 1.0, kind: "athlete", shade: "선수 대기실", water: "벤치 냉장 급수", aed: "본부석 의무실", x: 122, y: 180, w: 56, h: 60 },
];
const CROWD = ZONES.filter(z => z.kind === "crowd");
const DEFAULT_OFF = Object.fromEntries(ZONES.map(z => [z.id, z.off]));
const ACTIONS = {
  caution: ["해당 구역 관중에게 그늘·급수 위치 안내", "쿨링 브레이크 준비, 급수대·얼음 재고 점검", "의무요원 순찰 구역 조정"],
  warn: ["쿨링 브레이크 시행", "경기 시작·재개 지연 검토", "해당 구역에 의무요원 배치, 관중 그늘 이동 안내"],
  danger: ["경기 중단·연기 검토 (경기운영위원 판단)", "관중 실내·그늘 대피 안내", "구급차·의료진 대기, 119 연계 준비"],
};
const FAN_MSG = [
  "현재 이 구역은 안전 범위입니다.",
  "물을 자주 드시고, 어지러우면 그늘에서 쉬세요.",
  "햇볕을 피해 그늘로 이동하고 물을 자주 드세요.",
  "즉시 그늘이나 실내로 이동하세요. 몸이 이상하면 바로 알리세요.",
];
const WEATHER = ["맑음", "구름 조금", "흐림", "비", "바람 강함"];
const POLL_MS = 2000, HEARTBEAT_MS = 10000;

// ================= Helpers =================
function hm(m) { const h = Math.floor(m / 60), mm = m % 60; return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function lvStyle(lv) { return `--c:${LV[lv].c};--s:${LV[lv].s}`; }
function regStyle(r) { return `--c:${REG[r].c};--s:${REG[r].s}`; }
function zoneById(id) { return ZONES.find(z => z.id === id); }
function zn(id) { const z = zoneById(id); return z ? z.name : id; }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
const $ = id => document.getElementById(id);
function clockNow() { const d = new Date(); return { date: d.toLocaleDateString("sv-SE"), time: d.toTimeString().slice(0, 8) }; }
function newRoom() { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = ""; const r = new Uint32Array(4); (crypto || window.msCrypto).getRandomValues(r); r.forEach(x => { s += A[x % A.length]; }); return s; }
const HAS_SERVER = location.protocol === "http:" || location.protocol === "https:";

// 간이 WBGT (호주 기상청 근사식, 일사·바람은 평균 조건 가정)
function wbgtApprox(ta, rh) { const e = (rh / 100) * 6.105 * Math.exp((17.27 * ta) / (237.7 + ta)); return 0.567 * ta + 0.393 * e + 3.94; }
// 기상청 여름철 체감온도 (Stull 습구온도 기반)
function kmaFeels(ta, rh) {
  const tw = ta * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(ta + rh) - Math.atan(rh - 1.67633) + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
  return -0.2442 + 0.55399 * tw + 0.45535 * ta - 0.0022 * tw * tw + 0.00278 * tw * ta + 3.0;
}
function regLevel(f) { if (f == null || isNaN(f)) return null; return f >= 35 ? 2 : f >= 33 ? 1 : 0; }

function demoTimeline() { // 시연용 가상 데이터: 지역 체감온도는 경보(35℃) 기준에 1℃ 못 미치게 설계
  const pts = [];
  for (let m = 12 * 60; m <= 18 * 60; m += 10) {
    const h = m / 60, g = Math.exp(-((h - 14.5) ** 2) / (2 * 1.4 ** 2));
    pts.push({ label: hm(m), base: +(25 + 3.4 * g).toFixed(1), feels: +(30.6 + 3.4 * Math.exp(-((h - 14.5) ** 2) / (2 * 1.7 ** 2))).toFixed(1) });
  }
  return pts;
}

// ================= State =================
const S = {
  mode: "demo", view: "ops",
  timeline: demoTimeline(), sourceNote: "시연용 가상 시나리오",
  i: 8, playing: false, sel: "Z4", heatZone: "Z4", heat: 0, vuln: false,
  th: { ...DEFAULT_TH },
  measured: {},           // zoneId -> {v, t}
  alert: null,            // {id, time, max, zones:{id:lv}}
  log: [], emerg: null,
  fanZone: "Z4", fanLinked: false,
  remote: null,           // {time, zones, alert, emerg, via, at}
  settingsOpen: false, report: null,
  room: null, qrZone: "Z4",
  net: { state: HAS_SERVER ? "init" : "none", store: null, last: 0, fails: 0 },
  fieldLog: [],           // 현장 실측 기록 [{date,time,zone,v,height,weather,memo}]
  cond: { height: "1.1", weather: "맑음", memo: "" },
  seenAlert: null,
};
(function loadSaved() {
  try {
    const st = JSON.parse(lsGet("szr-settings") || "null");
    if (st) {
      if (st.th) for (const k of ["caution", "warn", "danger", "vuln"]) if (typeof st.th[k] === "number") S.th[k] = st.th[k];
      if (st.off) ZONES.forEach(z => { if (typeof st.off[z.id] === "number") z.off = st.off[z.id]; });
    }
    const fl = JSON.parse(lsGet("szr-fieldlog") || "null"); if (Array.isArray(fl)) S.fieldLog = fl.slice(0, 5000);
    const cd = JSON.parse(lsGet("szr-cond") || "null"); if (cd && typeof cd === "object") S.cond = { ...S.cond, ...cd };
  } catch (e) {}
  const z = lsGet("szr-fan-zone"); if (z && zoneById(z) && zoneById(z).kind === "crowd") S.fanZone = z;
})();
function saveSettings() { lsSet("szr-settings", JSON.stringify({ th: S.th, off: Object.fromEntries(ZONES.map(z => [z.id, z.off])) })); }
function saveField() { lsSet("szr-fieldlog", JSON.stringify(S.fieldLog)); lsSet("szr-cond", JSON.stringify(S.cond)); }

// Routing: /?r=ROOM#fan-Z4 (관중), /?r=ROOM (운영자). ?s=<snapshot> 은 서버 연결 실패 시 대체
(function route() {
  const h = (location.hash || "").replace("#", "");
  let qs; try { qs = new URLSearchParams(location.search); } catch (e) { qs = new URLSearchParams(); }
  const r = (qs.get("r") || "").toUpperCase();
  if (/^[A-Z0-9]{4,8}$/.test(r)) S.room = r;
  const snap = qs.get("s");
  if (h.startsWith("fan") || snap) {
    S.view = "fan"; S.fanLinked = true;
    const z = h.split("-")[1]; if (z && zoneById(z) && zoneById(z).kind === "crowd") S.fanZone = z;
    if (snap) { const d = decodeSnap(snap); if (d) S.remote = { ...d, via: "qr" }; }
  } else {
    if (!S.room) S.room = lsGet("szr-room") || newRoom();
    lsSet("szr-room", S.room);
    try { const u = new URL(location.href); u.searchParams.set("r", S.room); history.replaceState(null, "", u.pathname + u.search); } catch (e) {}
  }
})();

// ================= Model =================
function thresholds(z) { const shift = (S.vuln && z.kind === "athlete") ? S.th.vuln : 0; return { caution: S.th.caution - shift, warn: S.th.warn - shift, danger: S.th.danger - shift }; }
function levelOf(v, z) { const t = thresholds(z); if (v >= t.danger) return 3; if (v >= t.warn) return 2; if (v >= t.caution) return 1; return 0; }
function zoneValue(z, idx = S.i) {
  if (S.mode === "measure" && idx === S.i && S.measured[z.id]) return { v: S.measured[z.id].v, measured: S.measured[z.id].t };
  const base = S.timeline[idx].base;
  const heat = (S.mode === "demo" && idx === S.i && z.id === S.heatZone) ? S.heat : 0;
  return { v: +(base + z.off + heat).toFixed(1), measured: null };
}
function snapshot(idx = S.i) { return ZONES.map(z => { const r = zoneValue(z, idx); return { ...z, v: r.v, measured: r.measured, lv: levelOf(r.v, z) }; }); }
function worst(snap) { return snap.reduce((a, b) => (b.lv > a.lv || (b.lv === a.lv && b.v > a.v)) ? b : a); }
function now() { return S.timeline[S.i].label; }
function addLog(text) { S.log.unshift({ t: now(), w: clockNow().time, text }); S.log = S.log.slice(0, 300); }
function hasFeels() { return S.timeline.some(p => typeof p.feels === "number"); }

// 스냅샷(QR 대체 경로): "13:20|Z4.29.4.2,...|a13:20.Z4-2,Z5-2"
function encodeSnap() {
  const snap = snapshot().filter(z => z.kind === "crowd");
  let s = now() + "|" + snap.map(z => `${z.id}.${z.v.toFixed(1)}.${z.lv}`).join(",");
  if (S.alert) s += "|a" + S.alert.time + "." + Object.entries(S.alert.zones).map(([id, lv]) => `${id}-${lv}`).join(",");
  return s;
}
function decodeSnap(s) {
  try {
    const [time, zs, al] = s.split("|"); const zones = {};
    zs.split(",").forEach(p => { const parts = p.split("."); const id = parts[0]; const lv = +parts[parts.length - 1]; const v = +parts.slice(1, parts.length - 1).join("."); if (zoneById(id)) zones[id] = { v, lv }; });
    let alert = null;
    if (al && al.startsWith("a")) { const dot = al.indexOf("."); const az = {}; al.slice(dot + 1).split(",").forEach(p => { const [id, lv] = p.split("-"); if (zoneById(id)) az[id] = +lv; }); alert = { id: "snap", time: al.slice(1, dot), zones: az }; }
    return { time, zones, alert };
  } catch (e) { return null; }
}

// ================= Actions =================
function approve() {
  const snap = snapshot(); const w = worst(snap); if (w.lv === 0) return;
  const zones = {}; snap.filter(z => z.lv >= 1).forEach(z => { zones[z.id] = z.lv; });
  S.alert = { id: Date.now().toString(36), time: now(), max: w.lv, zones };
  addLog(`권고 승인 · ${LV[w.lv].name} · ${Object.keys(zones).map(zn).join(", ")} 알림 발송`);
  sync(true); update();
}
function hold() { const w = worst(snapshot()); if (w.lv === 0) return; addLog(`권고 보류 · ${LV[w.lv].name} · ${w.name}`); update(); }
function clearAlert() { if (!S.alert) return; addLog("관중 알림 해제"); S.alert = null; sync(true); update(); }
function resetDemo() {
  stopPlay();
  Object.assign(S, { mode: "demo", timeline: demoTimeline(), sourceNote: "시연용 가상 시나리오", i: 8, heat: 0, heatZone: "Z4", vuln: false, measured: {}, alert: null, emerg: null, log: [], report: null, sel: "Z4" });
  addLog("시연 초기화");
  renderOps(); sync(true);
}

// ================= Sync: 서버 방(room) + BroadcastChannel(같은 기기) =================
let bc = null;
try { bc = new BroadcastChannel("safezone-radar"); bc.onmessage = e => { const d = e.data; if (d && d.type === "hello") { if (S.view === "ops") sync(true); return; } if (d && d.room === S.room) onRemote(d.state, "same"); }; } catch (e) { bc = null; }
function hello() { try { if (bc && S.view === "fan") bc.postMessage({ type: "hello" }); } catch (e) {} }
function payload() {
  const snap = snapshot(); const zones = {}; snap.forEach(z => { zones[z.id] = { v: z.v, lv: z.lv }; });
  return { time: now(), zones, alert: S.alert ? { id: S.alert.id, time: S.alert.time, zones: S.alert.zones } : null, emerg: S.emerg ? { zone: S.emerg.zone, t: S.emerg.t } : null, src: S.sourceNote };
}
let syncTimer = null, lastPushed = "";
function sync(force) {
  if (S.view !== "ops") return;
  const p = payload();
  try { if (bc) bc.postMessage({ room: S.room, state: p }); } catch (e) {}
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushState(p, force), force ? 0 : 250);
}
async function pushState(p, force) {
  if (!HAS_SERVER || !S.room) return;
  const raw = JSON.stringify(p);
  if (!force && raw === lastPushed) return;
  try {
    const r = await fetch(`/api/state?room=${S.room}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: p }) });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); lastPushed = raw;
    setNet("ok", j.store);
  } catch (e) { setNet("fail"); }
}
function setNet(state, store) {
  const prev = S.net.state;
  if (state === "ok") { S.net.state = "ok"; S.net.last = Date.now(); S.net.fails = 0; if (store) S.net.store = store; }
  else { S.net.fails++; if (S.net.fails >= 2 || S.net.state === "init") S.net.state = "fail"; }
  if (prev !== S.net.state) { if (S.view === "ops") { netChip(); drawQR(); } else renderFan(); }
}
setInterval(() => { if (S.view === "ops") sync(true); }, HEARTBEAT_MS);

// 관중: 폴링
let polling = false;
async function poll() {
  if (polling || S.view !== "fan" || !HAS_SERVER || !S.room) return;
  if (document.visibilityState === "hidden") return;
  polling = true;
  try {
    const r = await fetch(`/api/state?room=${S.room}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    setNet("ok", j.store);
    if (j.state) onRemote(j.state, "server"); else if (S.view === "fan") renderFan();
  } catch (e) { setNet("fail"); }
  polling = false;
}
function onRemote(d, via) {
  if (S.view !== "fan" || !d || typeof d.zones !== "object") return;
  S.remote = { time: d.time, zones: d.zones, alert: d.alert, emerg: d.emerg, src: d.src, via, at: Date.now() };
  renderFan();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });

// ================= Rendering: operator =================
const app = $("app");
function render() { if (S.view === "fan") renderFan(); else renderOps(); }

function netInfo() {
  if (S.net.state === "none") return { cls: "off", text: "파일로 열림 · 서버 연결 없음" };
  if (S.net.state === "init") return { cls: "", text: "서버 연결 확인 중" };
  if (S.net.state === "fail") return { cls: "off", text: "오프라인 · 이 기기에서만 동작" };
  return { cls: "on", text: S.net.store === "redis" ? "실시간 연결" : "실시간 연결(간이)" };
}
function netChip() { const el = $("netchip"); if (!el) return; const n = netInfo(); el.className = "chip " + n.cls; el.textContent = n.text; el.title = S.net.store === "memory" ? "Redis가 연결되지 않아 서버 메모리에 임시 저장 중입니다. 안정적인 시연을 위해 Upstash Redis 연결을 권장합니다." : ""; }

function renderOps() {
  app.innerHTML = `
  <header class="top">
    <div class="brand"><h1>세이프존 레이더</h1><span class="venue">예시 경기장 A · 가상 구역 배치</span></div>
    <div class="chips">
      <span class="chip live">${S.mode === "replay" ? "기상청 자료 재현" : S.mode === "measure" ? "현장 실측" : "시연 모드"}</span>
      <span class="chip" id="srcnote">${esc(S.sourceNote)}</span>
      <span class="chip" id="netchip"></span>
      <span class="chip room" title="관중 화면과 연결되는 방 코드">방 ${esc(S.room)}</span>
      <div class="tabs" role="group" aria-label="데이터 모드">
        <button id="m-demo" aria-pressed="${S.mode === "demo"}">시연</button>
        <button id="m-measure" aria-pressed="${S.mode === "measure"}">현장 실측</button>
        <button id="m-replay" aria-pressed="${S.mode === "replay"}">기상청 재현</button>
      </div>
      <button class="btn" id="go-fan">관중 화면 미리보기</button>
      <button class="btn small" id="reset" title="알림·기록·가열값을 처음 상태로">시연 초기화</button>
    </div>
  </header>

  <section class="panel">
    <div class="clock">
      <span class="t num" id="clockT"></span>
      <button class="btn" id="play">${S.playing ? "일시정지" : "재생"}</button>
      <input type="range" id="tl" min="0" max="${S.timeline.length - 1}" value="${S.i}" aria-label="시각 이동">
      <span class="status" id="status"></span>
    </div>
    ${S.mode === "replay" ? `<div class="row"><label for="csv">기상청 ASOS 시간자료 CSV</label><input type="file" id="csv" accept=".csv,text/csv"><a class="btn small" href="/sample-kma-asos.csv" download>CSV 형식 예시 받기</a>
      <span class="note">기상자료개방포털(data.kma.go.kr) ASOS 시간자료(일시·기온·습도 열 포함)를 넣으면 간이 추정식으로 기준 WBGT를, 기상청 체감온도 식으로 지역 판정을 계산해 나란히 보여 줍니다. 실측이 아닌 추정입니다. 형식 예시 파일의 값은 가상값입니다.</span></div>` : ""}
    ${S.mode === "measure" ? `<div class="fieldform">
      <div class="row"><b style="font-size:13px">측정 조건</b>
        <label>측정 높이 <input class="set num" id="c-height" type="number" step="0.1" min="0" max="10" value="${esc(S.cond.height)}">m</label>
        <label>날씨 <select id="c-weather">${WEATHER.map(w => `<option ${w === S.cond.weather ? "selected" : ""}>${w}</option>`).join("")}</select></label>
        <label style="flex:1 1 200px">메모 <input type="text" id="c-memo" value="${esc(S.cond.memo)}" placeholder="측정기 모델, 그늘 여부 등"></label>
      </div>
      <div class="note">아래 구역 현황 표에 상용 WBGT 측정기 값을 입력하면 화면에 바로 반영되고, <b>실제 날짜·시각과 측정 조건이 함께 기록</b>됩니다(이 브라우저에 보관). 입력칸을 지우면 추정값으로 돌아갑니다.</div>
      <div class="row"><span class="note">실측 기록 <b class="num" id="fcount">${S.fieldLog.length}</b>건</span><button class="btn small" id="f-csv">실측 기록 CSV 저장</button><button class="btn small" id="meas-clear">화면 입력값 지우기</button><button class="btn small" id="f-clear">실측 기록 전체 삭제</button></div>
    </div>` : ""}
  </section>

  <div class="grid">
    <div class="col">
      <section class="panel">
        <div class="head"><h2>구역별 체감온도(WBGT)</h2><span class="sub">구역을 누르면 선택됩니다</span></div>
        <div class="mapwrap" id="map"></div>
        <div class="legend" id="legend"></div>
        <div class="row"><label><input type="checkbox" id="vuln" ${S.vuln ? "checked" : ""}> 체온조절 취약 선수군 경기 중 (선수 구역 기준 <span class="num" id="vulnN">${S.th.vuln}</span>℃ 낮춤)</label></div>
        ${S.mode === "demo" ? `<div class="row">
          <label>시연 가열 구역 <select id="hz">${ZONES.map(z => `<option value="${z.id}" ${z.id === S.heatZone ? "selected" : ""}>${z.name}</option>`).join("")}</select></label>
          <label>추가 열 <input type="range" id="heat" min="0" max="6" step="0.5" value="${S.heat}" style="accent-color:var(--warn)"> <span class="num" id="heatV"></span></label>
        </div>` : ""}
      </section>
      <section class="panel">
        <div class="head"><h2>구역 현황</h2><span class="sub">${S.mode === "measure" ? "측정값을 입력하면 추정값 대신 실측값을 씁니다" : "추정값 = 기준 체감온도 + 구역 보정값(가정)"}</span></div>
        <div class="tablewrap" id="ztable"></div>
      </section>
      <section class="panel" id="cmpPanel"></section>
      <section class="panel">
        <details class="settings" id="settings" ${S.settingsOpen ? "open" : ""}>
          <summary>기준값·구역 보정 설정</summary>
          <div class="setgrid">
            <div class="row">
              <label>주의 <input class="set num" id="th-caution" type="number" step="0.5" value="${S.th.caution}">℃</label>
              <label>경고 <input class="set num" id="th-warn" type="number" step="0.5" value="${S.th.warn}">℃</label>
              <label>위험 <input class="set num" id="th-danger" type="number" step="0.5" value="${S.th.danger}">℃</label>
              <label>취약 선수군 보정 <input class="set num" id="th-vuln" type="number" step="0.5" min="0" value="${S.th.vuln}">℃</label>
            </div>
            <div class="row">${ZONES.map(z => `<label>${z.name} <input class="set num" id="off-${z.id}" type="number" step="0.1" value="${z.off}"></label>`).join("")}</div>
            <div class="row"><span class="note" id="setmsg">값은 이 브라우저에 저장됩니다. 파일럿 실측 결과로 구역 보정값을 바꾸세요.</span><button class="btn small" id="set-reset">기본값으로</button></div>
          </div>
        </details>
      </section>
    </div>

    <div class="col">
      <div id="rec"></div>
      <div id="emergBox"></div>
      <section class="panel">
        <div class="head"><h2>관중 알림 연결</h2><span class="sub">좌석 구역 QR</span></div>
        <div class="qr"><div id="qrbox"></div>
          <div class="qrsel">
            <label class="row" style="gap:6px"><span class="note">QR 구역</span><select id="qz">${CROWD.map(z => `<option value="${z.id}" ${z.id === S.qrZone ? "selected" : ""}>${z.name}</option>`).join("")}</select></label>
            <div class="row" style="gap:6px"><button class="btn small" id="qrbig">발표용 크게 보기</button><button class="btn small" id="qrcopy">링크 복사</button></div>
            <div class="note" id="qrnote"></div>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="head"><h2>체감온도 추이</h2><span class="sub">최고 구역 기준 · 점선은 예측 구간</span></div>
        <div id="chart"></div>
      </section>
      <section class="panel">
        <div class="head"><h2>판단 기록</h2><div class="row"><button class="btn small" id="copylog">리포트 복사</button><button class="btn small" id="savecsv">CSV 저장</button></div></div>
        <ul class="log" id="log"></ul>
        <div id="reportBox"></div>
      </section>
    </div>
  </div>
  <p class="foot">기준값 26·28℃는 국제프로축구선수협회(FIFPRO) 권고를 참고했고, 30℃ 단계와 취약 선수군 보정은 내부 임시값입니다. 지역 판정 비교는 기상청 체감온도 33·35℃ 기준을 시각별로 단순 적용한 것으로, 실제 특보 발령 요건(지속 시간 등)과 다를 수 있습니다. 구역 보정값과 시설 위치는 예시이며 파일럿 실측으로 교체합니다. 시스템은 판단 근거를 제시할 뿐이며 경기 중단 등 최종 결정은 경기운영위원과 대회 의무관이 내립니다.</p>`;
  bindOps();
  netChip();
  update();
}

let lastQR = "";
function update() {
  if (S.view !== "ops") return;
  const snap = snapshot(); const w = worst(snap); const p = S.timeline[S.i];
  $("clockT").textContent = now();
  if ($("tl") && +$("tl").value !== S.i) $("tl").value = S.i;
  const rl = regLevel(p.feels);
  $("status").innerHTML = `기준 WBGT <b class="num">${p.base.toFixed(1)}℃</b> · 최고 구역 <b>${esc(w.name)}</b> <b class="num">${w.v.toFixed(1)}℃</b>` + (rl != null ? ` · 지역 체감온도 <b class="num">${p.feels.toFixed(1)}℃</b>` : "");
  if ($("heatV")) $("heatV").textContent = "+" + S.heat.toFixed(1) + "℃";
  $("map").innerHTML = mapSVG(snap);
  $("legend").innerHTML = LV.map((l, k) => `<span style="--c:${l.c}">${l.name} ${k === 0 ? "&lt;" + S.th.caution : k === 1 ? S.th.caution + "–" + S.th.warn : k === 2 ? S.th.warn + "–" + S.th.danger : "≥" + S.th.danger}℃</span>`).join("");
  $("ztable").innerHTML = zoneTable(snap);
  $("cmpPanel").innerHTML = cmpPanel(w);
  $("cmpPanel").hidden = !hasFeels();
  $("rec").innerHTML = recCard(snap, w);
  $("emergBox").innerHTML = S.emerg ? emergPanel() : `<section class="panel"><div class="head"><h2>응급 대응</h2></div>
    <div class="row"><label>발생 구역 <select id="ez">${ZONES.map(z => `<option value="${z.id}" ${z.id === S.sel ? "selected" : ""}>${z.name}</option>`).join("")}</select></label>
    <button class="btn danger" id="emerg">응급 상황 발생</button></div></section>`;
  $("chart").innerHTML = chartSVG();
  $("log").innerHTML = S.log.length ? S.log.map(l => `<li><span class="tm num">${l.t}</span><span>${esc(l.text)}</span></li>`).join("")
    : `<li><span class="tm">—</span><span class="note">권고 승인·보류, 응급 대응, 실측 입력이 시각·구역과 함께 기록됩니다.</span></li>`;
  $("reportBox").innerHTML = S.report != null ? `<p class="note">클립보드에 접근할 수 없어 아래에 표시했습니다. 전체 선택 후 복사하세요.</p><textarea class="report" id="reportTA" readonly>${esc(S.report)}</textarea>` : "";
  if ($("fcount")) $("fcount").textContent = S.fieldLog.length;
  bindDynamic();
  drawQR();
}

function mapSVG(snap) {
  const byId = Object.fromEntries(snap.map(z => [z.id, z]));
  const zoneG = (z) => {
    const r = byId[z.id]; const l = LV[r.lv];
    const cx = z.x + z.w / 2, cy = z.y + z.h / 2; const small = z.w < 90 && z.h < 90;
    const tag = z.tag + (r.measured ? " · 실측" : "");
    const alerted = S.alert && S.alert.zones[z.id] != null;
    return `<g class="zone ${S.sel === z.id ? "sel" : ""}" data-z="${z.id}" tabindex="0" role="button" aria-label="${z.name} ${r.v}도 ${l.name}">
      <rect class="zb" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="8" fill="${l.s}"/>
      <rect x="${z.x}" y="${z.y}" width="5" height="${z.h}" rx="2" fill="${l.c}" stroke="none"/>
      ${alerted && !small ? `<text x="${z.x + z.w - 8}" y="${z.y + 16}" text-anchor="end" font-size="12" fill="${l.c}" aria-hidden="true">●</text>` : ""}
      ${z.id === "F1" ? `<text class="zname" x="${z.x + z.w - 14}" y="${z.y + 22}" text-anchor="end">${z.name}</text><text class="zval" x="${z.x + z.w - 14}" y="${z.y + 42}" text-anchor="end">${r.v.toFixed(1)}℃</text><text class="ztag" x="${z.x + z.w - 14}" y="${z.y + 58}" text-anchor="end">${tag}</text>`
      : small ? `<text class="zname" x="${cx}" y="${cy - 6}" text-anchor="middle" style="font-size:10.5px">대기석</text><text class="zval" x="${cx}" y="${cy + 12}" text-anchor="middle" style="font-size:13px">${r.v.toFixed(1)}</text>`
      : `<text class="zname" x="${cx}" y="${cy - 10}" text-anchor="middle">${z.name}</text><text class="zval" x="${cx}" y="${cy + 10}" text-anchor="middle">${r.v.toFixed(1)}℃</text><text class="ztag" x="${cx}" y="${cy + 26}" text-anchor="middle">${tag}</text>`}
    </g>`;
  };
  return `<svg class="map" viewBox="0 0 600 420" role="img" aria-label="경기장 구역 지도">
    <rect x="1" y="1" width="598" height="418" rx="14" fill="var(--soft)"/>
    <rect x="20" y="280" width="72" height="120" rx="8" fill="none" stroke="var(--line)" stroke-dasharray="4 4"/>
    <text class="ztag" x="56" y="344" text-anchor="middle">출입 광장</text>
    ${["F1", "Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "F2"].map(id => zoneG(zoneById(id))).join("")}
    <ellipse cx="300" cy="210" rx="120" ry="70" fill="none" stroke="var(--field-line)" stroke-width="1.5" pointer-events="none"/>
    <line x1="300" y1="100" x2="300" y2="320" stroke="var(--field-line)" stroke-width="1.5" pointer-events="none"/>
  </svg>`;
}

function zoneTable(snap) {
  const m = S.mode === "measure";
  return `<table><thead><tr><th>구역</th><th>특성</th><th>보정(가정)</th><th>체감온도</th><th>단계</th>${m ? "<th>측정값 입력(℃)</th>" : ""}</tr></thead><tbody>
  ${snap.map(z => `<tr class="${S.sel === z.id ? "sel" : ""}"><td>${z.name}</td><td>${z.tag}</td><td class="num">${z.off > 0 ? "+" : ""}${z.off.toFixed(1)}</td>
    <td class="num">${z.v.toFixed(1)}℃ ${z.measured ? `<span class="measured">실측 ${z.measured}</span>` : ""}</td>
    <td><span class="pill" style="${lvStyle(z.lv)}">${LV[z.lv].name}</span></td>
    ${m ? `<td><input class="meas num" id="meas-${z.id}" type="number" step="0.1" min="0" max="45" inputmode="decimal" placeholder="—" value="${S.measured[z.id] ? S.measured[z.id].v : ""}" aria-label="${z.name} 측정값"></td>` : ""}</tr>`).join("")}
  </tbody></table>`;
}

// 지역 특보 판정 vs 구역 단계 비교 (같은 시각, 다른 위험)
function cmpPanel(w) {
  if (!hasFeels()) return "";
  const p = S.timeline[S.i]; const rl = regLevel(p.feels);
  const zoneLv = S.timeline.map((q, k) => worst(snapshot(k)).lv);
  const regLv = S.timeline.map(q => regLevel(q.feels));
  const cells = (arr, sty) => arr.map((v, k) => `<i class="${k === S.i ? "now" : ""}" style="${v == null ? "--c:transparent" : sty(v)}" title="${S.timeline[k].label}"></i>`).join("");
  const zoneHours = zoneLv.filter(v => v >= 2).length, regHours = regLv.filter(v => v >= 2).length;
  const stepMin = S.timeline.length > 1 ? (() => { const a = S.timeline[0].label.split(":"), b = S.timeline[1].label.split(":"); const d = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]); return d > 0 ? d : null; })() : null;
  const dur = n => stepMin ? `${Math.round(n * stepMin)}분` : `${n}개 시각`;
  return `<div class="head"><h2>지역 특보 판정 vs 경기장 구역</h2><span class="sub">같은 시각, 다른 위험</span></div>
    <div class="cmp">
      <div style="${regStyle(rl ?? 0)}"><span class="k">지역 판정 · 기상청 체감온도 <span class="num">${p.feels != null ? p.feels.toFixed(1) + "℃" : "—"}</span></span><span class="v">${rl != null ? REG[rl].name : "자료 없음"}</span></div>
      <div style="${lvStyle(w.lv)}"><span class="k">경기장 최고 구역 · ${esc(w.name)} <span class="num">${w.v.toFixed(1)}℃</span> WBGT</span><span class="v">${LV[w.lv].name}</span></div>
    </div>
    <div class="band">
      <div class="r"><b>지역 판정</b><div class="cells">${cells(regLv, v => v === 0 ? "--c:var(--line)" : regStyle(v))}</div></div>
      <div class="r"><b>최고 구역 단계</b><div class="cells">${cells(zoneLv, lvStyle)}</div></div>
      <div class="r"><span></span><span class="note">경고 이상: 경기장 구역 <b class="num">${dur(zoneHours)}</b> · 지역 경보 수준 <b class="num">${dur(regHours)}</b> (${esc(S.mode === "demo" ? "시연용 가상값" : "추정값")})</span></div>
    </div>`;
}

function recCard(snap, w) {
  const alertRow = S.alert ? `<div class="row"><span class="note">발송 중인 관중 알림: ${esc(S.alert.time)} · ${Object.keys(S.alert.zones).map(zn).join(", ")}</span><button class="btn small" id="clearAlert">알림 해제</button></div>` : "";
  if (w.lv === 0) return `<section class="card" style="${lvStyle(0)}"><div class="lvl"><span class="big">정상</span><span class="who">모든 구역이 주의 기준 아래입니다</span></div>
    <div class="note">권고 없음. 기준 체감온도와 구역별 값을 계속 감시합니다.</div>${alertRow}</section>`;
  const affected = snap.filter(z => z.lv >= 1).sort((a, b) => b.v - a.v);
  const sent = S.alert && S.alert.time === now() && S.alert.max === w.lv;
  return `<section class="card" style="${lvStyle(w.lv)}" aria-live="polite">
    <div class="lvl"><span class="big">${LV[w.lv].name} 권고</span><span class="pill" style="${lvStyle(w.lv)};background:var(--panel)">${esc(w.name)} <span class="num">${w.v.toFixed(1)}℃</span></span></div>
    <div class="who">대상 구역: ${affected.map(z => `${z.name}(${z.v.toFixed(1)}, ${LV[z.lv].name})`).join(", ")}</div>
    <ul>${ACTIONS[LV[w.lv].key].map(a => `<li>${a}</li>`).join("")}</ul>
    <div class="acts"><button class="btn primary" id="approve" ${sent ? "disabled" : ""}>${sent ? "알림 발송됨" : "승인하고 관중 알림 발송"}</button><button class="btn" id="hold">보류</button></div>
    ${alertRow}
    <div class="who">최종 결정: 경기운영위원 · 대회 의무관</div>
  </section>`;
}

function emergPanel() {
  const z = zoneById(S.emerg.zone);
  return `<section class="emerg" aria-live="assertive">
    <div class="head"><h2>응급 상황 · ${z.name}</h2><span class="num">${S.emerg.t}</span></div>
    <div>가장 가까운 AED: <b>${z.aed}</b> (예시 위치)</div>
    <ol><li>119 신고, 현장 의무요원 호출</li><li>가장 가까운 AED를 가져오도록 지정</li><li>의식·호흡이 없으면 즉시 심폐소생술 시작</li><li>현장 응급 매뉴얼과 의료진 지시에 따름</li></ol>
    <div class="note">해당 구역 관중 화면에 '의료진 출동 중 · 통로 확보' 안내가 표시됩니다.</div>
    <div class="acts"><button class="btn" id="emerg-done">대응 종료 기록</button></div>
  </section>`;
}

function chartSVG() {
  const W = 520, H = 210, L = 38, R = 12, T = 12, B = 28;
  const n = S.timeline.length;
  if (n < 2) return `<p class="note">추이를 그리려면 시각이 2개 이상 필요합니다.</p>`;
  const vals = S.timeline.map((p, k) => Math.max(...ZONES.map(z => zoneValue(z, k).v)));
  const lo = Math.floor(Math.min(...vals, S.th.caution) - 1), hi = Math.ceil(Math.max(...vals, S.th.danger) + 0.5);
  const X = k => L + (k / (n - 1)) * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = vals.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`);
  const past = pts.slice(0, S.i + 1).join(" "), fut = pts.slice(S.i).join(" ");
  const step = hi - lo > 12 ? 4 : 2;
  const ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const all = S.timeline.map((p, k) => ({ k, p }));
  let cand = all.filter(o => o.p.label.endsWith(":00")); if (cand.length < 2) cand = all;
  const stride = Math.max(1, Math.ceil(cand.length / 7));
  const xt = cand.filter((o, j) => j % stride === 0);
  const thLine = (v, lv) => v > lo && v < hi ? `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${LV[lv].c}" stroke-dasharray="3 3" stroke-width="1"/><text x="${W - R}" y="${Y(v) - 4}" text-anchor="end" font-size="10.5" fill="${LV[lv].c}">${LV[lv].name} ${v}</text>` : "";
  const area = `${X(0)},${Y(lo)} ${past} ${X(S.i)},${Y(lo)}`;
  const tx = Math.min(X(S.i) + 7, W - R - 46);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="체감온도 추이">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--soft)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)" class="num">${v}</text>`).join("")}
    ${xt.map(o => `<text x="${X(o.k)}" y="${H - 8}" text-anchor="${o.k === 0 ? "start" : o.k === n - 1 ? "end" : "middle"}" font-size="10.5" fill="var(--muted)" class="num">${o.p.label}</text>`).join("")}
    ${thLine(S.th.caution, 1)}${thLine(S.th.warn, 2)}${thLine(S.th.danger, 3)}
    <polygon points="${area}" fill="var(--accent)" fill-opacity="0.08"/>
    <polyline points="${past}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <polyline points="${fut}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.7"/>
    <line x1="${X(S.i)}" x2="${X(S.i)}" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" opacity="0.35"/>
    <circle cx="${X(S.i)}" cy="${Y(vals[S.i])}" r="4.5" fill="var(--accent)" stroke="var(--panel)" stroke-width="2"/>
    <text x="${tx}" y="${Y(vals[S.i]) - 8}" font-size="11" font-weight="600" fill="var(--ink)" class="num">${vals[S.i].toFixed(1)}℃</text>
  </svg>`;
}

// ================= QR =================
function fanURL(zone) {
  const u = new URL(location.origin + location.pathname);
  u.searchParams.set("r", S.room);
  // 서버 연결이 안 될 때를 대비해 찍는 순간의 상태도 함께 담는다
  if (S.net.state !== "ok") u.searchParams.set("s", encodeSnap());
  return u.toString() + "#fan-" + zone;
}
function qrTarget() {
  if (location.protocol === "file:") return { url: null, note: "파일로 열면 휴대폰에서 이 주소를 열 수 없습니다. Vercel에 배포한 주소에서 사용하세요." };
  const url = fanURL(S.qrZone);
  const note = S.net.state === "ok"
    ? `휴대폰으로 찍으면 <b>${esc(zn(S.qrZone))}</b> 관중 화면이 열리고, 권고를 승인하면 몇 초 안에 알림·진동이 갑니다.`
    : `서버 연결이 없어 찍는 순간의 상태만 전달됩니다. 권고 승인 후 QR을 찍으세요.`;
  return { url, note };
}
function drawQR() {
  const box = $("qrbox"), noteEl = $("qrnote"); if (!box) return;
  const t = qrTarget();
  noteEl.innerHTML = t.note;
  const key = t.url || "none";
  if (key === lastQR && box.childElementCount) return;
  lastQR = key; box.innerHTML = "";
  if (!t.url) { box.textContent = "웹 주소에서 QR 표시"; return; }
  makeQR(box, t.url, 108);
}
function makeQR(el, text, size) {
  if (typeof QRCode === "undefined") { el.textContent = "QR 라이브러리를 불러오지 못했습니다"; return; }
  try { new QRCode(el, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.L }); } catch (e) { el.textContent = "QR을 만들 수 없습니다"; }
}
function openQRModal() {
  const t = qrTarget(); if (!t.url) return;
  const m = $("modal");
  m.innerHTML = `<div class="modal" id="mbg" role="dialog" aria-modal="true" aria-label="관중 QR"><div class="box">
    <h3>${esc(zn(S.qrZone))} 좌석 QR</h3><div class="big" id="bigqr"></div>
    <p>휴대폰 카메라로 찍으면 이 구역의 관중 화면이 열립니다 · 방 <b>${esc(S.room)}</b></p>
    <button class="btn" id="mclose" style="color:#111;background:#fff">닫기</button></div></div>`;
  makeQR($("bigqr"), t.url, 512);
  const close = () => { m.innerHTML = ""; document.removeEventListener("keydown", esck); };
  const esck = e => { if (e.key === "Escape") close(); };
  $("mclose").onclick = close; $("mbg").onclick = e => { if (e.target.id === "mbg") close(); };
  document.addEventListener("keydown", esck); $("mclose").focus();
}

// ================= Rendering: spectator =================
function fanData() {
  const z = zoneById(S.fanZone);
  if (S.remote && S.remote.zones && S.remote.zones[z.id]) {
    const r = S.remote.zones[z.id];
    return { v: r.v, lv: r.lv, alert: S.remote.alert, emerg: S.remote.emerg, time: S.remote.time, via: S.remote.via, at: S.remote.at };
  }
  if (S.fanLinked) return { v: null, lv: 0, alert: null, emerg: null, time: null, via: "wait" };
  const r = zoneValue(z); return { v: r.v, lv: levelOf(r.v, z), alert: S.alert, emerg: S.emerg, time: now(), via: "local" };
}
function notify(lv, zoneName) {
  try { if (navigator.vibrate) navigator.vibrate(lv >= 3 ? [300, 120, 300, 120, 300] : [250, 120, 250]); } catch (e) {}
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = notify.ctx || (notify.ctx = new AC()); if (ctx.state === "suspended") ctx.resume();
    [0, 0.25].forEach(d => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = lv >= 3 ? 880 : 660; g.gain.setValueAtTime(0.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.2); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.22); });
  } catch (e) {}
}
function renderFan() {
  if (S.view !== "fan") return;
  const z = zoneById(S.fanZone); const d = fanData();
  const live = d.via === "server" || d.via === "same";
  const offline = S.fanLinked && HAS_SERVER && S.net.state === "fail";
  let viaLabel = { qr: `QR 스캔 시점 ${d.time || ""} 기준`, same: "실시간 연결", server: "실시간 연결", local: "운영자 미리보기", wait: "운영본부 연결 대기" }[d.via];
  if (offline) viaLabel = d.at ? `연결 끊김 · 마지막 수신 ${new Date(d.at).toTimeString().slice(0, 5)}` : "연결 끊김";
  const alertLv = d.alert && d.alert.zones && d.alert.zones[z.id] != null ? d.alert.zones[z.id] : null;
  const isNew = alertLv != null && alertLv >= 1 && d.alert.id && d.alert.id !== S.seenAlert && d.via !== "local";
  if (isNew) { S.seenAlert = d.alert.id; notify(alertLv, z.name); }
  const emergHere = d.emerg && d.emerg.zone === z.id;
  app.innerHTML = `
  <div class="phone">
    <div class="fanbar"><strong>세이프존 레이더</strong><span class="chip ${offline ? "off" : live ? "live" : ""}">${esc(viaLabel)}</span></div>
    <label class="row" style="justify-content:space-between" for="fz"><span class="note">내 좌석 구역</span>
      <select id="fz">${CROWD.map(q => `<option value="${q.id}" ${q.id === z.id ? "selected" : ""}>${q.name}</option>`).join("")}</select></label>
    ${emergHere ? `<div class="fanemerg" role="alert"><b>이 구역에 의료진이 출동 중입니다.</b><br>통로를 비워 주시고 안전요원 안내를 따라 주세요.</div>` : ""}
    ${alertLv != null && alertLv >= 1 ? `<div class="push ${isNew ? "flash" : ""}" role="alert" style="${lvStyle(alertLv)}"><small>${esc(d.alert.time)} 운영본부 알림</small>${z.name} 구역이 <b>${LV[alertLv].name}</b> 단계입니다. 아래 그늘·급수대 위치를 확인하세요.</div>` : ""}
    ${d.v == null ? `<div class="fancard" style="${lvStyle(0)}"><span class="v">${z.name}</span><span>운영본부의 상태 정보를 기다리고 있습니다.${HAS_SERVER ? " 잠시 후 자동으로 표시됩니다." : ""}</span></div>`
      : `<div class="fancard" style="${lvStyle(d.lv)}"><span class="v">${z.name} · 체감온도</span><span class="lv">${LV[d.lv].name} <span class="num">${d.v.toFixed(1)}℃</span></span><span>${FAN_MSG[d.lv]}</span></div>`}
    <div class="guide">
      <div><b>가까운 그늘</b><span>${z.shade}</span></div>
      <div><b>급수대</b><span>${z.water}</span></div>
      <div><b>AED</b><span>${z.aed}</span></div>
    </div>
    <div class="note">몸이 이상하면 가까운 안전요원에게 알리세요. 응급 신고: <a href="tel:119"><b>119</b></a></div>
    <div class="note">위치 정보는 수집하지 않습니다. 좌석 구역만 선택합니다. 시설 위치는 예시입니다.${S.room && S.fanLinked ? ` · 방 ${esc(S.room)}` : ""}</div>
    ${S.fanLinked && !S.seenAlert && "vibrate" in navigator ? `<div class="note">알림 진동·소리를 받으려면 화면을 한 번 눌러 주세요.</div>` : ""}
    ${S.fanLinked ? "" : `<button class="btn" id="go-ops">운영자 화면으로</button>`}
  </div>`;
  $("fz").addEventListener("change", e => { S.fanZone = e.target.value; lsSet("szr-fan-zone", S.fanZone); try { history.replaceState(null, "", location.pathname + location.search + "#fan-" + S.fanZone); } catch (er) {} renderFan(); });
  if ($("go-ops")) $("go-ops").addEventListener("click", () => { S.view = "ops"; S.remote = null; renderOps(); });
}
// 첫 터치로 오디오 잠금 해제(모바일 브라우저 정책)
document.addEventListener("pointerdown", () => { try { const AC = window.AudioContext || window.webkitAudioContext; if (AC && !notify.ctx) { notify.ctx = new AC(); } if (notify.ctx && notify.ctx.state === "suspended") notify.ctx.resume(); } catch (e) {} }, { once: true });

// ================= Events =================
let timer = null;
function stopPlay() { S.playing = false; clearInterval(timer); timer = null; if ($("play")) $("play").textContent = "재생"; }
function bindOps() {
  $("m-demo").onclick = () => setMode("demo");
  $("m-measure").onclick = () => setMode("measure");
  $("m-replay").onclick = () => setMode("replay");
  $("reset").onclick = () => { if (confirm("알림·판단 기록·가열값을 처음 상태로 되돌릴까요? (실측 기록과 설정은 유지)")) resetDemo(); };
  $("go-fan").onclick = () => { stopPlay(); S.view = "fan"; S.remote = null; renderFan(); hello(); };
  $("play").onclick = () => {
    if (S.playing) { stopPlay(); return; }
    if (S.i >= S.timeline.length - 1) S.i = 0;
    S.playing = true; $("play").textContent = "일시정지";
    timer = setInterval(() => { if (S.i < S.timeline.length - 1) { S.i++; sync(); update(); } else stopPlay(); }, 800);
  };
  $("tl").addEventListener("input", e => { S.i = +e.target.value; update(); });
  $("tl").addEventListener("change", () => sync());
  $("vuln").onchange = e => { S.vuln = e.target.checked; addLog(S.vuln ? "취약 선수군 기준 적용" : "취약 선수군 기준 해제"); sync(); update(); };
  if ($("hz")) $("hz").onchange = e => { S.heatZone = e.target.value; update(); sync(); };
  if ($("heat")) { $("heat").addEventListener("input", e => { S.heat = +e.target.value; update(); }); $("heat").addEventListener("change", () => sync()); }
  if ($("csv")) $("csv").onchange = e => { const f = e.target.files[0]; if (f) loadCSV(f); };
  if ($("meas-clear")) $("meas-clear").onclick = () => { S.measured = {}; addLog("화면 실측 입력값 지움"); sync(); update(); };
  if ($("f-csv")) $("f-csv").onclick = saveFieldCSV;
  if ($("f-clear")) $("f-clear").onclick = () => { if (!S.fieldLog.length) return; if (confirm(`실측 기록 ${S.fieldLog.length}건을 모두 지울까요? CSV로 먼저 저장하세요.`)) { S.fieldLog = []; saveField(); update(); } };
  if ($("c-height")) $("c-height").onchange = e => { S.cond.height = e.target.value; saveField(); };
  if ($("c-weather")) $("c-weather").onchange = e => { S.cond.weather = e.target.value; saveField(); };
  if ($("c-memo")) $("c-memo").onchange = e => { S.cond.memo = e.target.value.slice(0, 200); saveField(); };
  $("settings").addEventListener("toggle", e => { S.settingsOpen = e.target.open; });
  ["caution", "warn", "danger", "vuln"].forEach(k => $("th-" + k).addEventListener("change", e => setTh(k, e.target.value)));
  ZONES.forEach(z => $("off-" + z.id).addEventListener("change", e => { const v = parseFloat(e.target.value); if (!isNaN(v) && Math.abs(v) <= 10) { z.off = v; saveSettings(); addLog(`구역 보정 변경 · ${z.name} ${v > 0 ? "+" : ""}${v.toFixed(1)}`); sync(); update(); } else { e.target.value = z.off; setMsg("보정값은 -10~+10 사이로 입력하세요."); } }));
  $("set-reset").onclick = () => { S.th = { ...DEFAULT_TH }; ZONES.forEach(z => { z.off = DEFAULT_OFF[z.id]; }); saveSettings(); addLog("기준값·구역 보정 기본값 복원"); S.settingsOpen = true; setTimeout(() => { renderOps(); sync(); }, 0); };
  $("copylog").onclick = copyReport;
  $("savecsv").onclick = saveCSV;
  $("qz").onchange = e => { S.qrZone = e.target.value; drawQR(); };
  $("qrbig").onclick = openQRModal;
  $("qrcopy").onclick = () => { const t = qrTarget(); if (!t.url) return; try { navigator.clipboard.writeText(t.url).then(() => flash("qrcopy", "복사했습니다"), () => prompt("링크를 복사하세요", t.url)); } catch (e) { prompt("링크를 복사하세요", t.url); } };
}
function setMsg(t) { if ($("setmsg")) $("setmsg").textContent = t; }
function setTh(k, raw) {
  const v = parseFloat(raw); const next = { ...S.th, [k]: v };
  if (isNaN(v) || next.caution >= next.warn || next.warn >= next.danger || next.vuln < 0 || next.vuln > 6) {
    setMsg("기준값은 주의 < 경고 < 위험 순서여야 하고, 취약 선수군 보정은 0~6℃입니다."); $("th-" + k).value = S.th[k]; return;
  }
  S.th = next; saveSettings(); setMsg("저장했습니다."); if ($("vulnN")) $("vulnN").textContent = S.th.vuln;
  addLog(`기준값 변경 · 주의 ${S.th.caution} / 경고 ${S.th.warn} / 위험 ${S.th.danger}`); sync(); update();
}
function bindDynamic() {
  document.querySelectorAll("#map .zone").forEach(g => { const f = () => { S.sel = g.dataset.z; if (zoneById(S.sel).kind === "crowd") { S.qrZone = S.sel; if ($("qz")) $("qz").value = S.sel; } update(); }; g.addEventListener("click", f); g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } }); });
  document.querySelectorAll("input.meas").forEach(inp => inp.addEventListener("change", e => {
    const id = e.target.id.replace("meas-", ""); const raw = e.target.value.trim();
    if (raw === "") { delete S.measured[id]; addLog(`실측값 삭제 · ${zn(id)}`); }
    else {
      const v = parseFloat(raw); if (isNaN(v) || v < 0 || v > 45) { e.target.value = S.measured[id] ? S.measured[id].v : ""; return; }
      const nv = +v.toFixed(1); if (S.measured[id] && S.measured[id].v === nv && S.measured[id].t === now()) return;
      const c = clockNow();
      S.measured[id] = { v: nv, t: c.time.slice(0, 5) };
      S.fieldLog.unshift({ date: c.date, time: c.time, zone: id, zoneName: zn(id), v: nv, height: S.cond.height, weather: S.cond.weather, memo: S.cond.memo });
      saveField();
      addLog(`실측 입력 · ${zn(id)} ${nv.toFixed(1)}℃ (${c.time.slice(0, 5)})`);
    }
    setTimeout(() => { sync(); update(); }, 0);
  }));
  if ($("approve")) $("approve").onclick = approve;
  if ($("hold")) $("hold").onclick = hold;
  if ($("clearAlert")) $("clearAlert").onclick = clearAlert;
  if ($("emerg")) $("emerg").onclick = () => { const zid = $("ez").value; S.emerg = { zone: zid, t: now() }; addLog(`응급 상황 · ${zn(zid)} · AED 위치 안내`); sync(true); update(); };
  if ($("emerg-done")) $("emerg-done").onclick = () => { addLog(`응급 대응 종료 · ${zn(S.emerg.zone)}`); S.emerg = null; sync(true); update(); };
  if ($("reportTA")) $("reportTA").onfocus = e => e.target.select();
}
function setMode(m) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  stopPlay();
  S.mode = m;
  if (m === "demo") { S.timeline = demoTimeline(); S.sourceNote = "시연용 가상 시나리오"; S.i = Math.min(S.i, S.timeline.length - 1); }
  if (m === "measure") S.sourceNote = "측정기 실측값 우선, 나머지는 추정";
  if (m === "replay" && S.sourceNote.indexOf("기상청") < 0) S.sourceNote = "CSV를 넣기 전에는 시연 시나리오 표시";
  renderOps(); sync();
}
function reportText() { return ["세이프존 레이더 판단 기록", `자료: ${S.sourceNote}`, `방: ${S.room}`, ...S.log.slice().reverse().map(l => `${l.t}\t${l.text}`)].join("\n"); }
function copyReport() {
  const txt = reportText();
  const fallback = () => { S.report = txt; update(); const ta = $("reportTA"); if (ta) { ta.focus(); ta.select(); } };
  try { if (!navigator.clipboard) { fallback(); return; } navigator.clipboard.writeText(txt).then(() => { S.report = null; update(); flash("copylog", "복사했습니다"); }, fallback); } catch (e) { fallback(); }
}
function flash(id, t) { const b = $(id); if (!b) return; const o = b.textContent; b.textContent = t; setTimeout(() => { if ($(id)) $(id).textContent = o; }, 1500); }
function downloadCSV(rows, name) {
  const csv = "﻿" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  try {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return true;
  } catch (e) { return false; }
}
function saveCSV() { if (!downloadCSV([["시나리오 시각", "실제 시각", "기록"], ...S.log.slice().reverse().map(l => [l.t, l.w || "", l.text])], "세이프존레이더_판단기록.csv")) copyReport(); }
function saveFieldCSV() {
  if (!S.fieldLog.length) { flash("f-csv", "기록 없음"); return; }
  downloadCSV([["날짜", "시각", "구역ID", "구역", "WBGT 실측(℃)", "측정 높이(m)", "날씨", "메모"], ...S.fieldLog.slice().reverse().map(r => [r.date, r.time, r.zone, r.zoneName, r.v, r.height, r.weather, r.memo])], `세이프존레이더_실측기록_${clockNow().date}.csv`);
}

// ================= KMA CSV replay =================
function splitCSV(line) { const out = []; let cur = "", q = false; for (let k = 0; k < line.length; k++) { const c = line[k]; if (c === '"') q = !q; else if (c === "," && !q) { out.push(cur.trim()); cur = ""; } else cur += c; } out.push(cur.trim()); return out; }
function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;
  const head = splitCSV(lines[0]);
  const iT = head.findIndex(h => h.includes("일시")), iA = head.findIndex(h => h.startsWith("기온")), iR = head.findIndex(h => h.startsWith("습도"));
  if (iT < 0 || iA < 0 || iR < 0) return null;
  const out = [];
  for (const l of lines.slice(1)) {
    const c = splitCSV(l); const ta = parseFloat(c[iA]), rh = parseFloat(c[iR]);
    if (isNaN(ta) || isNaN(rh)) continue;
    const t = c[iT] || ""; const m = t.match(/(\d{1,2}):(\d{2})/);
    out.push({ label: m ? m[1].padStart(2, "0") + ":" + m[2] : t, date: t.slice(0, 10), base: +wbgtApprox(ta, rh).toFixed(1), feels: +kmaFeels(ta, rh).toFixed(1), ta, rh });
  }
  return out.length >= 2 ? out.slice(0, 1500) : null;
}
function loadCSV(file) {
  const r = new FileReader();
  r.onerror = () => { S.sourceNote = "파일을 읽지 못했습니다"; renderOps(); };
  r.onload = () => {
    const buf = r.result; let data = null;
    for (const enc of ["utf-8", "euc-kr"]) { try { data = parseCSV(new TextDecoder(enc).decode(buf)); } catch (e) { data = null; } if (data) break; }
    if (!data) { S.sourceNote = "CSV에서 일시·기온·습도 열을 찾지 못했습니다"; renderOps(); return; }
    S.timeline = data; S.i = 0; S.alert = null;
    S.sourceNote = `기상청 관측 기반 추정 · ${data[0].date}${data[data.length - 1].date !== data[0].date ? " ~ " + data[data.length - 1].date : ""}`;
    addLog(`기상청 자료 불러옴 · ${data.length}개 시각`); renderOps(); sync(true);
  };
  r.readAsArrayBuffer(file);
}

// ================= Start =================
addLog("시스템 시작 · 시연 시나리오 로드");
render();
if (S.view === "ops") sync(true); else { hello(); poll(); setInterval(poll, POLL_MS); }
if ("serviceWorker" in navigator && HAS_SERVER && location.hostname !== "localhost") { window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); }); }
window.addEventListener("online", () => { if (S.view === "ops") sync(true); else poll(); });
