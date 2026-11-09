// The page's script: the class picker, the best-maps chart, the latest-runs bar and a little motion.
// (Its own file so the site can tell browsers to run no other scripts: see _headers.)

// The site's old address sends people to the new one, keeping their choices (level, class...). Only the page is
// moved: the old /api/ address keeps answering for overlays from before the move. Only the exact old host, so
// preview deployments and a local test server are left alone.
const OLD_HOST = "maple-classic-exp-overlay.pages.dev", NEW_SITE = "https://mcwo.app";
function movedTo(loc) {
  return loc.hostname === OLD_HOST ? NEW_SITE + loc.pathname + loc.search + loc.hash : null;
}
if (typeof location !== "undefined" && movedTo(location)) {
  location.replace(movedTo(location));
  throw new Error("moved to " + NEW_SITE);          // (stops this script: the page is being replaced)
}
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n === null || n === undefined) ? "?" : Math.round(n).toLocaleString("en-US");
const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e5 ? Math.round(n / 1e3) + "k"
  : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : fmt(n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const partyName = (p) => p === "solo" ? "单人" : "组队";
const soloOrParty = (p) => p === "solo" || p === "1" ? "solo"          // also party sizes, from the
  : p === "party" || /^[2-6]$/.test(p ?? "") ? "party" : null;         // overlay's link or older visits
const PLURAL_ZH = { player: "位玩家", "new player": "位新玩家", "more player": "位玩家", map: "张地图", "more map": "张地图" };
const plural = (n, word) => `${fmt(n)} ${PLURAL_ZH[word] ?? word}`;
const mostPlayers = (list) => [...list].sort((a, b) => b.players - a.players)[0];
const JOIN = `<a class="more" href="#overlay">获取悬浮窗并分享你的刷怪数据</a>`;
// Hours of farming: "45 min", "2.5 hours", "1,204 hours"
const hours = (h) => {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟`;
  const n = h < 10 ? Math.round(h * 10) / 10 : Math.round(h);
  return `${n.toLocaleString("en-US")} 小时`;
};
const SECOND_JOB = 30;   // the level paths start at (2nd job); before it, a class is one group
let classes = [];        // from the server: Warrior, Magician, Archer, Thief, each with its paths
let wantPath = null;     // the path last picked, kept while the level is under SECOND_JOB

function saved() {
  try { return JSON.parse(localStorage.getItem("ask") || "null") || {}; } catch { return {}; }
}

/** What the overlay's "Best maps" link asks for, e.g. ?level=32&party=1&job=Bandit (party: its size). */
function fromLink(q = new URLSearchParams(location.search)) {
  const job = q.get("job"), out = {};
  const level = parseInt(q.get("level"), 10);
  if (level >= 1 && level <= 250) out.level = level;
  if (soloOrParty(q.get("party"))) out.party = soloOrParty(q.get("party"));
  for (const c of classes) {
    if (c.name === job || (job === "Bowman" && c.name === "Archer")) out.job = c.name;
    for (const p of c.paths) {
      const at = p.steps.indexOf(job);
      if (at >= 0) out.job = c.name;
      if (at > 0) out.path = p.name;      // a 2nd to 4th job: that path (a 1st job is on all of them)
    }
  }
  const asked = q.get("path");
  if (out.job && asked && classes.find((c) => c.name === out.job)?.paths.some((p) => p.name === asked)) out.path = asked;
  if (Object.hasOwn(SORTS, q.get("sort"))) out.sort = q.get("sort");
  if (q.get("hide") === "early") out.showEarly = false;      // (links from when early data showed by default)
  if (q.get("early") === "1") out.showEarly = true;
  if (q.get("view") === "ladder") out.view = "ladder";
  if (q.get("new") === "1") out.withNew = true;
  return out;
}

function chosenClass() {
  const picked = document.querySelector('input[name="job"]:checked');
  return classes.find((c) => c.name === picked?.value);
}

const firstJob = () => parseInt($("level").value, 10) < SECOND_JOB;

/** Picks a class (the one asked for, or the one most players are on) and fills in its paths. */
function pickClass(name) {
  const c = classes.find((c) => c.name === name) || mostPlayers(classes);
  document.querySelector(`input[name="job"][value="${esc(c.name)}"]`).checked = true;
  fillPaths();
}

/** The class's paths, or, under Lv 30, its 1st job with Path greyed out. */
function fillPaths() {
  const c = chosenClass();
  if (!c) return;
  const off = firstJob();
  $("path").disabled = off;
  $("path-field").classList.toggle("off", off);
  if (off) {
    $("path").innerHTML = `<option>${esc(c.paths[0].steps[0])} （一转）</option>`;
    $("path-hint").textContent = `路线从 Lv ${SECOND_JOB} 开始，即二转之后。`;
    return;
  }
  $("path").innerHTML = c.paths.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.players
    ? ` · ${plural(p.players, "player")}` : ""}</option>`).join("");
  $("path").value = c.paths.some((p) => p.name === wantPath) ? wantPath : mostPlayers(c.paths).name;
  showSteps();
}

function showSteps() {         // e.g. "Rogue → Bandit → Chief Bandit → Shadower"
  const p = chosenClass()?.paths.find((p) => p.name === $("path").value);
  $("path-hint").textContent = p ? p.steps.map((job) => job.replace(/ \(.*\)$/, "")).join(" → ") : "";
}

async function loadOptions() {
  let data = null;
  try { data = await (await fetch("/api/options", { cache: "no-store" })).json(); } catch {}
  if (!data?.classes?.length) {
    $("results").innerHTML = `<div class="note">无法加载地图，请稍后再试。</div>`;
    return;
  }
  classes = data.classes;
  $("counts").style.display = data.runs ? "" : "none";       // no big zeros on day one
  $("c-hours").textContent = (data.hours || 0) < 10 ? String(Math.round((data.hours || 0) * 10) / 10) : fmt(data.hours);
  $("c-players").textContent = fmt(data.players || 0);
  newPlayers = data.players_new || 0;
  $("c-players-l").textContent = newPlayers ? `玩家（另有 ${fmt(newPlayers)} 位新玩家）` : "玩家";
  $("c-players-l").title = newPlayers ? "新玩家在一天后且满 4 次记录后才会对所有人计入。在“最佳地图”中勾选“包含新玩家”可立即看到他们。" : "";
  $("c-maps").textContent = fmt(data.maps || 0);
  ["c-hours", "c-players", "c-maps"].forEach((id) => countUp($(id)));
  $("classes").innerHTML = classes.map((c) => `<label><input type="radio" name="job" value="${esc(c.name)}">` +
    `<span>${esc(c.name)}</span></label>`).join("");
  const link = fromLink(), linked = Object.keys(link).length > 0;
  const last = { ...saved(), ...link };
  if (Object.hasOwn(SORTS, last.sort)) view.sort = last.sort;
  view.hideEarly = !last.showEarly;          // (the old "hide" setting is ignored: hidden is the new default)
  view.withNew = !!last.withNew;
  view.tab = link.view === "ladder" ? "ladder" : "maps";
  setTabs();
  if (last.level) $("level").value = last.level;
  if (soloOrParty(String(last.party))) $("party").value = soloOrParty(String(last.party));
  wantPath = last.path || null;
  pickClass(last.job);
  if (!data.runs) {
    $("results-title").textContent = "社区地图才刚刚起步";
    $("results-sub").textContent = "";
    $("results").innerHTML = `<div class="note"><h3>来做第一批分享的人吧！</h3>
      使用悬浮窗的玩家每刷满 15 分钟，就会出现在这里。随着更多玩家加入，这里会填满每个职业、路线和等级的最佳地图。<br>${JOIN}</div>`;
    if (linked) $("results-section").scrollIntoView({ block: "start" });
    return;
  }
  ask(null, linked);
}

// What the page is showing: which view, how it's sorted, and the last answer (so changing the sort or
// the tab never asks the server again, and asking the same thing twice within 15 minutes doesn't either).
const SORTS = {
  exp: ["经验/小时", (m) => m.exp_hr, "最佳之选"],
  mesos: ["金币/小时", (m) => m.mesos_hr ?? -1, "金币最多"],
};
const TOP = 5;                               // maps shown before "Show more" (all of them come in one answer)
// (early data is hidden unless the visitor shows it; showAll lasts until the next question)
const view = { sort: "exp", hideEarly: true, showAll: false, withNew: false, tab: "maps" };
const NEW_TIP = "最近加入的玩家。他们在一天后且满 4 次记录后才会对所有人计入。";
const newBox = () => `<label class="chk" title="${NEW_TIP}"><input type="checkbox" id="with-new"${view.withNew ? " checked" : ""}> 包含新玩家</label>`;
/** Ticking "Include new players" asks again (it's in the chart's toolbar, the ladder's, and the empty answers). */
function hookNew() {
  $("with-new")?.addEventListener("change", (e) => { view.withNew = e.target.checked; remember(); ask(null, false); });
}
let newPlayers = 0;                          // players who joined lately and don't count yet (from /api/options)
let current = null;                          // { data, level, party, job, path }
const memo = new Map();
const MEMO_MS = 15 * 60 * 1000;

/** An answer from the server, kept for 15 minutes: the same question isn't asked twice. */
async function getJson(url) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.data;
  const data = await (await fetch(url, { cache: "no-store" })).json();
  if (!data.error) memo.set(url, { at: Date.now(), data });
  return data;
}

/** The address follows what's chosen, so any view can be shared or bookmarked. */
function syncUrl() {
  const c = chosenClass();
  if (!c) return;
  const q = new URLSearchParams({ level: $("level").value, party: $("party").value, job: c.name });
  if (!firstJob() && $("path").value) q.set("path", $("path").value);
  if (view.sort !== "exp") q.set("sort", view.sort);
  if (!view.hideEarly) q.set("early", "1");
  if (view.withNew) q.set("new", "1");
  if (view.tab === "ladder") q.set("view", "ladder");
  try { history.replaceState(null, "", `${location.pathname}?${q}`); } catch {}
}

function setTabs() {
  for (const [id, tab] of [["tab-maps", "maps"], ["tab-ladder", "ladder"]]) {
    $(id).setAttribute("aria-selected", String(view.tab === tab));
    $(id).tabIndex = view.tab === tab ? 0 : -1;
  }
}

async function ask(event, scroll = !!event) {
  if (event) event.preventDefault();
  const c = chosenClass();
  if (!c) return;
  const level = Math.max(1, Math.min(250, parseInt($("level").value, 10) || 30)), party = $("party").value;
  $("level").value = level;
  fillPaths();
  const job = c.name, path = level < SECOND_JOB ? null : $("path").value;
  try {
    localStorage.setItem("ask", JSON.stringify({ job, path: path || wantPath, level, party, sort: view.sort, showEarly: !view.hideEarly, withNew: view.withNew }));
  } catch {}
  syncUrl();
  if (view.tab === "ladder") return showLadder(job, path, level, party, scroll);
  const who = path ? `${esc(path)} (${esc(job)})` : esc(job);
  $("results-title").textContent = "Best maps";
  $("results-sub").innerHTML = `<b>${who}</b>，Lv ${level}，${partyName(party)}。`;
  $("results").innerHTML = `<div class="note">查找中……</div>`;
  if (scroll) $("results-section").scrollIntoView({ behavior: "smooth", block: "start" });
  let data;
  try {
    const query = new URLSearchParams({ class: job, ...(path ? { path } : {}), level, party, ...(view.withNew ? { new: "1" } : {}) });
    data = await getJson(`/api/stats?${query}`);
    if (data.busy) { $("results").innerHTML = `<div class="note">现在访问的人很多，请几分钟后再试。</div>`; return; }
    if (data.error) throw new Error(data.error);
  } catch {
    $("results").innerHTML = `<div class="note">无法加载地图，请稍后再试。</div>`;
    return;
  }
  if (!Array.isArray(data.early)) data.early = [];       // (an answer from before early data: none)
  current = { data, level, party, job, path };
  const [lo, hi] = data.levels;
  $("results-sub").innerHTML = `<b>${who}</b>，Lv ${level}，${partyName(party)}。每张地图使用 Lv ${lo}–${hi} 的玩家数据，`
    + `只有在需要更多玩家时才会放宽范围（该行会注明）。` + (view.withNew ? " 包含新玩家。" : "") +
    (data.newest_run ? ` 最新记录分享于${esc(ago(data.newest_run))}。` : "");
  if (!data.maps.length && !data.early.length) {
    $("results").innerHTML = `<div class="note"><h3>这里还没有地图</h3>
      只要有一位你等级附近的玩家在某张地图上分享过记录，它就会出现。
      分享你自己的刷怪数据，帮忙把它填满。<br>${JOIN}</div>${newPlayers || view.withNew ? `<div class="tools">${newBox()}</div>` : ""}`;
    hookNew();
    return;
  }
  view.showAll = false;
  showChart(true);
}

// ---------------------------------------------------------------- the chart
// One row per map, all on one scale: a dot for every player (their typical run), the
// typical EXP/hr (gold line), what the middle half of players get (the bar), and the runs
// left out as unusual (hollow rings).

const motion = () => !!window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches;
const compact = (n) => n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`
  : String(Math.round(n));
let shown = null;                          // what's on the chart now, for the details on hover
let watcher = null;                        // starts each row's animation as it scrolls into view

/** A scale with round numbers that fits every map's dots and bars. (Left-out runs can be far
 * off: they're pinned to the edge with their number.) */
function scaleFor(maps) {
  const all = maps.flatMap((m) => [m.exp_hr, m.exp_hr_low, m.exp_hr_high, ...(m.dots || [])]).filter((n) => n > 0);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < hi * 0.15) { lo *= 0.85; hi *= 1.12; }
  const pad = (hi - lo) * 0.08;
  lo = Math.max(0, lo - pad); hi += pad;
  const rough = (hi - lo) / 4, p = 10 ** Math.floor(Math.log10(rough)), f = rough / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  return { lo, hi, ticks, x: (n) => Math.max(0, Math.min(100, (n - lo) / (hi - lo) * 100)) };
}

/** "Steady" when most players get about the same, "Varies a lot" when it depends on you. */
function spread(m) {
  if (m.players < 5) return "";
  const r = (m.exp_hr_high - m.exp_hr_low) / m.exp_hr;
  return r < 0.15 ? `<span class="chip steady" title="这里大多数玩家的收益差不多">稳定</span>`
    : r > 0.35 ? `<span class="chip varies" title="装备、技能和地图拥挤程度在这里影响很大">差异很大</span>`
    : "";
}

/** 0 to 4: a player's level against yours: 4+ lower, 1-3 lower, the same, 1-3 higher, 4+ higher. */
const bucket = (lv) => { const d = lv - current.level; return d <= -4 ? 0 : d < 0 ? 1 : d === 0 ? 2 : d < 4 ? 3 : 4; };
const BUCKETS = ["低 4 级以上", "低 1–3 级", "同等级", "高 1–3 级", "高 4 级以上"];
const off = (lv) => { const d = lv - current.level; return d === 0 ? "同等级" : `比你${d > 0 ? "高" : "低"} ${Math.abs(d)} 级`; };

function rowHtml(m, i, s, early, need, rank = i + 1) {
  const x = s.x, dots = m.dots || [], out = m.unusual || [], dl = m.dot_levels || [], ul = m.unusual_levels || [];
  const dn = m.dot_new || [], un = m.unusual_new || [];
  const lo = x(m.exp_hr_low), hi = x(m.exp_hr_high), mid = x(m.exp_hr);
  const band = early || m.players < 2 ? "" : `<b class="band" style="left:${lo}%;width:${Math.max(0.8, hi - lo)}%;` +
    `transform-origin:${hi > lo ? ((mid - lo) / (hi - lo)) * 100 : 50}% 50%"></b>`;
  const edge = (d) => d > s.hi ? `<span class="edge" style="right:0">${compact(d)} ›</span>`
    : d < s.lo ? `<span class="edge" style="left:0">‹ ${compact(d)}</span>` : "";
  const lvAttr = (lv) => Number.isFinite(lv) ? ` data-lv="${Number(lv)}" data-b="${bucket(Number(lv))}"` : "";
  const marks = dots.map((d, k) => `<i class="dot${dn[k] ? " fresh" : ""}" style="left:${x(d)}%" data-v="${Number(d)}"${lvAttr(dl[k])}></i>`).join("") +
    out.map((d, k) => `<i class="dot out${un[k] ? " fresh" : ""}" style="left:${x(d)}%" data-v="${Number(d)}"${lvAttr(ul[k])}></i>${edge(d)}`).join("");
  const best = i === 0 && !early && !m.widened;
  const levels = m.levels ? `Lv ${Number(m.levels[0])}–${Number(m.levels[1])}` : "";
  const widened = m.widened ? `<span class="chip widen" title="你等级的玩家不够多，所以这张地图使用了更宽等级范围的玩家">范围更宽</span>` : "";
  const fresh = m.new_players ? `<span class="chip fresh" title="这里有 ${plural(m.new_players, "player")}最近加入，尚未对所有人计入（需一天且满 4 次记录）">包含 ${plural(m.new_players, "new player")}</span>` : "";
  const id = `${early ? "e" : "m"}${i}`;
  return `<div class="row${best ? " best" : ""}${early ? " early" : ""}" data-at="${id}">
    <div class="rank">${early ? "" : rank}</div>
    <div class="info"><h3>${esc(m.map)}${best ? `<span class="tag">${esc(SORTS[view.sort][2])}</span>` : ""}</h3>
      <div class="meta">${plural(m.players, "player")} · ${hours(m.hours)}<span class="wide-only"> 的刷怪数据</span></div>
      <div class="meta">${levels}${widened ? " " + widened : ""}${fresh ? " " + fresh : ""}</div>
      ${early ? `<span class="chip wait">还需 ${plural(need, "more player")}</span>` : spread(m)}
      <button class="open" type="button" aria-expanded="false" aria-controls="d-${id}">详情 <i aria-hidden="true"></i></button></div>
    <div class="track" aria-hidden="true"><i class="base"></i>${s.ticks.map((t) => `<i class="grid" style="left:${x(t)}%"></i>`).join("")}
      ${band}<b class="med" style="left:${mid}%"></b>${marks}</div>
    <div class="nums"><div class="exp"><span data-n="${Number(m.exp_hr)}">${fmt(m.exp_hr)}</span><small>经验/小时</small></div>
      <div class="mesos">${m.mesos_hr === null ? "金币/小时未知" : `${fmt(m.mesos_hr)} 金币/小时`}</div></div>
    <span class="sr-only">典型 ${fmt(m.exp_hr)} 经验/小时${m.players > 1 ? `；一半的玩家为 ${fmt(m.exp_hr_low)} 到 ${fmt(m.exp_hr_high)}` : ""}。</span>
  </div>`;
}

/** The panel under a map: EXP/hr by party size (solo, 2 to 6) and by level. */
function detailHtml(m, id) {
  const sizes = m.by_party || [];          // (sizes nobody farmed here aren't in it)
  const top = Math.max(1, ...sizes.map((b) => b.exp_hr));
  const mine = (n) => current.party === "solo" ? n === 1 : n >= 2;
  const party = `<div class="d-card"><h4>按队伍人数的经验/小时</h4>${sizes.length ? `<div class="pt-rows">${sizes.map((b) =>
    `<div class="pt${mine(b.party) ? " me" : ""}"><span>${b.party === 1 ? "单人" : `${Number(b.party)} 人队伍`}<small>${plural(b.players, "player")}</small></span>
      <i aria-hidden="true"><i style="width:${Math.max(4, b.exp_hr / top * 100).toFixed(0)}%"></i></i><b>${fmt(b.exp_hr)}</b></div>`).join("")}</div>`
    : `<p class="d-none">还没有按队伍人数的记录。</p>`}</div>`;
  const tall = Math.max(1, ...m.by_level.map((b) => b.exp_hr));
  const bars = m.by_level.map((b) => `<div class="lvb${b.level === current.level ? " me" : ""}" tabindex="0" data-lv="${Number(b.level)}" data-exp="${Number(b.exp_hr)}" data-n="${Number(b.players)}">
      <i style="height:${Math.max(6, b.exp_hr / tall * 100).toFixed(0)}%"></i><span>${Number(b.level)}</span></div>`).join("");
  const levels = `<div class="d-card"><h4>按等级的经验/小时</h4>${m.by_level.length > 1
    ? `<div class="lv-bars" role="group" aria-label="各等级的每小时经验，从 ${Number(m.by_level[0].level)} 到 ${Number(m.by_level.at(-1).level)}">${bars}</div>
      <div class="lv-tip" role="status" aria-live="polite"><b></b><span></span></div>`
    : `<p class="d-none">目前这里的玩家都在同一个等级。</p>`}</div>`;
  return `<div class="detail" id="d-${id}" role="region" aria-label="${esc(m.map)} 的详情">${party}${levels}</div>`;
}

/** The chart with the current sort and filter. `animate` is false when only the order changed. */
function showChart(animate = true) {
  const { data } = current, key = SORTS[view.sort][1];
  const bySort = (a, b) => key(b) - key(a);
  const near = data.maps.filter((m) => !m.widened).sort(bySort), wide = data.maps.filter((m) => m.widened).sort(bySort);
  const maps = [...near, ...wide];                  // (the details look maps up by this order)
  const early = view.hideEarly ? [] : data.early;
  shown = { maps, early };
  const touch = matchMedia("(hover: none)").matches;
  const minPlayers = data.min_players, far = Number(data.ranges[data.ranges.length - 1]);
  const tools = `<div class="tools">
      <label>排序方式 <select id="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${k === view.sort ? " selected" : ""}>${esc(v[0])}</option>`).join("")}</select></label>
      ${data.early.length ? `<label class="chk"><input type="checkbox" id="hide-early"${view.hideEarly ? " checked" : ""}> 隐藏早期数据</label>` : ""}
      ${newPlayers || view.withNew ? newBox() : ""}
    </div>`;
  const hook = () => {
    $("sort").addEventListener("change", (e) => { view.sort = e.target.value; remember(); showChart(false); });
    $("hide-early")?.addEventListener("change", (e) => { view.hideEarly = e.target.checked; remember(); showChart(false); });
    hookNew();
  };
  if (!maps.length && !early.length) {             // nothing ranked, and early data is hidden
    $("results").innerHTML = `<div class="chart">${tools}<div class="early-head none-head"><b>这里还没有参与排名的地图</b>
      <span>还没有哪张地图有 ${Number(minPlayers)} 位你等级附近的玩家。</span>
      <button class="more-btn inline" type="button" id="show-early">显示早期数据（${plural(data.early.length, "map")}）</button></div></div>`;
    $("show-early").addEventListener("click", () => { view.hideEarly = false; remember(); showChart(true); });
    hook();
    return;
  }
  const s = scaleFor([...maps, ...early]);
  // In order: maps at your level, the wider range, early data. Only the first TOP maps show until "Show more".
  const parts = near.map((m, i) => ({ row: true, html: rowHtml(m, i, s, false) }));
  if (wide.length) {
    parts.push({ html: `<div class="early-head wide-head"><b>范围更宽</b>
      <span>${near.length ? "你上下 " + Number(data.ranges[0]) + " 级内的玩家不够多，所以这些地图使用了最远相差 " + far + " 级的玩家，对你等级的针对性较弱。"
        : "你上下 " + Number(data.ranges[0]) + " 级内还没有人分享足够的记录，所以这些地图使用了最远相差 " + far + " 级的玩家。"}</span></div>` });
    wide.forEach((m, j) => parts.push({ row: true, html: rowHtml(m, near.length + j, s, false, 0, j + 1) }));
  }
  if (early.length) {
    parts.push({ html: `<div class="early-head"><b>${maps.length ? "早期数据" : "这里还没有参与排名的地图"}</b>
      <span>${maps.length ? `目前不足 ${Number(minPlayers)} 位玩家，所以尚未参与排名。`
        : `还没有哪张地图有 ${Number(minPlayers)} 位你等级附近的玩家。以下是目前收到的数据。`}</span></div>` });
    early.forEach((m, i) => parts.push({ row: true, html: rowHtml(m, i, s, true, minPlayers - m.players) }));
  }
  const rows = parts.filter((p) => p.row).length, extra = Math.max(0, rows - TOP);
  let cut = parts.length;
  for (let k = 0, seen = 0; k < parts.length; k++) if (parts[k].row && ++seen === TOP) { cut = k + 1; break; }
  const html = (list) => list.map((p) => p.html).join("");
  const moreLabel = () => view.showAll ? `只显示前 ${TOP} 张` : `显示另外 ${plural(extra, "more map")}`;
  $("results").innerHTML = `<div class="chart">
    ${tools}
    <div class="chart-top">
      <div class="legend" aria-hidden="true"><span><i class="lg-dot"></i>一位玩家</span><span><i class="lg-med"></i>典型</span>
        <span><i class="lg-band"></i>中间一半的玩家</span><span><i class="lg-out"></i>被剔除（异常）</span>${view.withNew ? `<span><i class="lg-dot lg-fresh"></i>新玩家</span>` : ""}</div>
      <div class="legend lv-legend" aria-hidden="true"><b>圆点颜色 = 玩家等级</b>${BUCKETS.map((t, k) => `<span><i class="lg-dot" data-b="${k}"></i>${t}</span>`).join("")}</div>
      <small>${touch ? "点按" : "指向"}圆点查看详情</small>
    </div>
    <div class="axis" aria-hidden="true"><div class="scale">${s.ticks.map((t) => `<b style="left:${s.x(t)}%">${compact(t)}</b>`).join("")}</div></div>
    ${html(parts.slice(0, cut))}
    ${extra ? `<div id="more-rows"${view.showAll ? "" : " hidden"}>${html(parts.slice(cut))}</div>
      <button class="more-btn" type="button" id="more-btn" aria-expanded="${view.showAll}" aria-controls="more-rows">${moreLabel()}</button>` : ""}
    <div class="chart-foot">Each player counts once, however much they play, and a new player's runs start counting after a day.
      ${JOIN.replace('class="more" ', "")}</div>
  </div><div class="tip" role="status"><b></b><span></span></div>`;
  spreadDots();
  hookDetails();
  if (animate) animateChart();
  $("more-btn")?.addEventListener("click", (e) => {
    view.showAll = !view.showAll;
    $("more-rows").hidden = !view.showAll;
    e.currentTarget.setAttribute("aria-expanded", String(view.showAll));
    e.currentTarget.textContent = moreLabel();
    if (view.showAll) spreadDots();            // (hidden rows had no width to spread their dots on)
    else e.currentTarget.scrollIntoView({ block: "nearest" });
  });
  hook();
}

/** Keeps the sort and filter for next time, and in the address. */
function remember() {
  try { localStorage.setItem("ask", JSON.stringify({ ...saved(), sort: view.sort, showEarly: !view.hideEarly, withNew: view.withNew })); } catch {}
  syncUrl();
}

// A map's details open under it (a button, or a click on its name or numbers; the dots keep their own pointing).
$("results").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row || !current || e.target.closest(".track")) return;
  const open = row.nextElementSibling?.classList.contains("detail");
  const button = row.querySelector(".open");
  if (open) {
    row.nextElementSibling.remove();
    button.setAttribute("aria-expanded", "false");
    return;
  }
  const at = row.dataset.at;
  const m = (at[0] === "e" ? shown.early : shown.maps)[+at.slice(1)];
  row.insertAdjacentHTML("afterend", detailHtml(m, at));
  button.setAttribute("aria-expanded", "true");
});

// Point at (or tap, or tab to) a level's bar in a map's details: what it is, in words.
{
  const show = (bar) => {
    const card = bar.closest(".d-card"), tip = card.querySelector(".lv-tip");
    card.querySelectorAll(".lvb.on").forEach((b) => b.classList.remove("on"));
    bar.classList.add("on");
    const lv = Number(bar.dataset.lv), n = Number(bar.dataset.n);
    tip.querySelector("b").textContent = `Lv ${lv} · ${fmt(Number(bar.dataset.exp))} 经验/小时`;
    tip.querySelector("span").textContent = `${plural(n, "player")} · ${off(lv)}`;
    const c = card.getBoundingClientRect(), r = bar.querySelector("i").getBoundingClientRect(), half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half + 2, Math.min(c.width - half - 2, r.left + r.width / 2 - c.left))}px`;
    tip.style.top = `${r.top - c.top - 6}px`;
    tip.classList.add("show");
  };
  const hide = (card) => { card?.querySelectorAll(".lvb.on").forEach((b) => b.classList.remove("on")); card?.querySelector(".lv-tip")?.classList.remove("show"); };
  const box = $("results");
  box.addEventListener("pointerover", (e) => { const b = e.target.closest?.(".lvb"); if (b) show(b); });
  box.addEventListener("pointerdown", (e) => { const b = e.target.closest?.(".lvb"); if (b) show(b); });
  box.addEventListener("focusin", (e) => { const b = e.target.closest?.(".lvb"); if (b) show(b); });
  box.addEventListener("pointerout", (e) => { if (e.pointerType !== "touch" && e.target.closest?.(".lvb") && !e.relatedTarget?.closest?.(".lvb")) hide(e.target.closest(".d-card")); });
  box.addEventListener("focusout", (e) => { if (e.target.closest?.(".lvb")) hide(e.target.closest(".d-card")); });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.(".lvb")) box.querySelectorAll(".d-card").forEach(hide); });
}

// ---------------------------------------------------------------- the leveling ladder
// For the class and path chosen: the best maps in each band of 5 levels, to plan the whole climb.

async function showLadder(job, path, level, party, scroll) {
  const who = path ? `${esc(path)} (${esc(job)})` : esc(job);
  $("results-title").textContent = "升级阶梯";
  $("results-sub").innerHTML = `<b>${who}</b>（${partyName(party)}）每个阶段的最佳地图。点击一张地图可查看该等级下的情况。`;
  $("results").innerHTML = `<div class="note">查找中……</div>`;
  if (scroll) $("results-section").scrollIntoView({ behavior: "smooth", block: "start" });
  let data;
  try {
    const query = new URLSearchParams({ class: job, ...(path ? { path } : {}), party, ...(view.withNew ? { new: "1" } : {}) });
    data = await getJson(`/api/ladder?${query}`);
    if (data.busy) { $("results").innerHTML = `<div class="note">现在访问的人很多，请几分钟后再试。</div>`; return; }
    if (data.error) throw new Error(data.error);
  } catch {
    $("results").innerHTML = `<div class="note">无法加载升级阶梯，请稍后再试。</div>`;
    return;
  }
  if (!data.bands.length) {
    $("results").innerHTML = `<div class="note"><h3>还没有升级阶梯</h3>一个阶段要有 ${Number(data.min_players)} 位玩家在那里分享过地图才会出现。<br>${JOIN}</div>${newPlayers || view.withNew ? `<div class="tools">${newBox()}</div>` : ""}`;
    hookNew();
    return;
  }
  $("results").innerHTML = `<div class="chart ladder">${newPlayers || view.withNew ? `<div class="tools">${newBox()}</div>` : ""}${data.bands.map((b) => {
    const me = level >= b.from && level <= b.to;
    return `<div class="stage${me ? " me" : ""}"><div class="lv">Lv ${Number(b.from)}–${Number(b.to)}${me ? "<small>你在这里</small>" : ""}</div>
      <div class="picks">${b.maps.map((m, i) => `<button type="button" class="pick${i === 0 ? " top" : ""}" data-level="${Math.max(1, Number(b.from) + 2)}">
        <b>${esc(m.map)}</b><span>${fmt(m.exp_hr)} 经验/小时 · ${m.pct_hr === null ? "" : `${Number(m.pct_hr)}% 每小时 · `}${plural(m.players, "player")}${m.new_players ? ` （${m.new_players} 位新玩家）` : ""}</span></button>`).join("")}</div></div>`;
  }).join("")}<div class="chart-foot">每个阶段为这 5 个等级内的玩家排名地图（需要 3 位玩家）。${view.withNew ? " 包含新玩家。" : ""} ${JOIN.replace('class="more" ', "")}</div></div>`;
  hookNew();
  $("results").querySelector(".stage.me")?.scrollIntoView({ block: "nearest" });
}

$("results").addEventListener("click", (e) => {
  const pick = e.target.closest(".pick");
  if (!pick) return;
  $("level").value = pick.dataset.level;
  view.tab = "maps";
  setTabs();
  ask(null, true);
});

for (const [id, tab] of [["tab-maps", "maps"], ["tab-ladder", "ladder"]]) {
  $(id).addEventListener("click", () => { view.tab = tab; setTabs(); ask(null, false); });
}

$("copy-link").addEventListener("click", async () => {
  syncUrl();
  const button = $("copy-link"), text = button.textContent;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "链接已复制";
  } catch {
    button.textContent = "请从地址栏复制";
  }
  setTimeout(() => { button.textContent = text; }, 2200);
});

/** Dots close together are moved up or down a little, so each one can be seen. */
function spreadDots() {
  const lanes = [0, -7, 7, -14, 14];
  document.querySelectorAll("#results .track").forEach((track) => {
    const w = track.clientWidth, last = new Map();
    [...track.querySelectorAll(".dot")].map((el) => ({ el, at: parseFloat(el.style.left) / 100 * w }))
      .sort((a, b) => a.at - b.at).forEach(({ el, at }) => {
        const lane = lanes.find((y) => !last.has(y) || at - last.get(y) >= 10) ??
          lanes.reduce((a, b) => (last.get(a) <= last.get(b) ? a : b));
        last.set(lane, at);
        el.style.setProperty("--y", `${lane}px`);
      });
  });
}

/** Point at (or tap) a row: the nearest dot, the gold line or the bar says what it is. */
function hookDetails() {
  const box = $("results"), tip = box.querySelector(".tip");
  let lit = null;
  const hide = () => { tip.classList.remove("show"); lit?.classList.remove("on"); lit = null; };
  const say = (el, title, text, track) => {
    if (lit !== el) { lit?.classList.remove("on"); el.classList.add("on"); lit = el; }
    tip.querySelector("b").textContent = title;
    tip.querySelector("span").textContent = text;
    const wrap = box.getBoundingClientRect(), r = el.getBoundingClientRect(), t = track.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const left = Math.max(half + 4, Math.min(wrap.width - half - 4, r.left + r.width / 2 - wrap.left));
    if (!tip.classList.contains("show")) { tip.classList.add("jump"); void tip.offsetWidth; }
    tip.style.left = `${left}px`;
    tip.style.top = `${t.top - wrap.top + 4}px`;
    tip.classList.add("show");
    requestAnimationFrame(() => tip.classList.remove("jump"));
  };
  box.querySelectorAll(".track").forEach((track) => {
    const row = track.closest(".row"), at = row.dataset.at;
    const m = (at[0] === "e" ? shown.early : shown.maps)[+at.slice(1)], early = at[0] === "e";
    const move = (e) => {
      const px = e.clientX - track.getBoundingClientRect().left, reach = e.pointerType === "touch" ? 26 : 16;
      let near = null, gap = reach;
      for (const el of track.querySelectorAll(".dot, .med")) {
        const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - px);
        if (d < gap) { near = el; gap = d; }
      }
      const band = track.querySelector(".band");
      if (!near && band && px >= band.offsetLeft && px <= band.offsetLeft + band.offsetWidth) near = band;
      if (!near) return hide();
      const v = Number(near.dataset.v);
      if (near.classList.contains("out")) {
        const lv = near.dataset.lv ? ` · Lv ${near.dataset.lv}` : "";
        say(near, `${fmt(v)} 经验/小时 · 已剔除${lv}`, v > m.exp_hr
          ? "超过这里其他玩家收益的两倍：可能是蹭经验，或装备差距很大。"
          : "不到这里其他玩家收益的一半：可能是挂机，或并没有真的在刷。", track);
      } else if (near.classList.contains("dot")) {
        const lv = near.dataset.lv;
        say(near, `${fmt(v)} 经验/小时${lv ? ` · Lv ${lv}` : ""}`,
          lv ? `One player's typical run here (${off(Number(lv))}).` : "One player's typical run here.", track);
      } else if (near.classList.contains("med")) {
        say(near, `典型 ${fmt(m.exp_hr)} 经验/小时`, early ? `目前来自 ${plural(m.players, "player")}。`
          : "一半的玩家更高，一半更低。", track);
      } else {
        say(near, `${short(m.exp_hr_low)} – ${short(m.exp_hr_high)} 经验/小时`, "中间一半玩家的收益范围。", track);
      }
    };
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerdown", move);
    track.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); });
    track.addEventListener("pointercancel", hide);
  });
  hideDetails = hide;
}
let hideDetails = () => {};
document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.("#results .track")) hideDetails(); });

/** Each row comes in as it scrolls into view: the bar grows out from the typical line,
 * the dots pop in from left to right and the number counts up. */
function animateChart() {
  watcher?.disconnect();
  if (!motion()) return;
  const box = $("results");
  gsap.from(box.querySelectorAll(".legend span, .chart-top small, .axis b"),
    { autoAlpha: 0, duration: 0.8, stagger: 0.035, ease: "power2.out", clearProps: "opacity,visibility" });
  watcher = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, n) => {
      watcher.unobserve(e.target);
      gsap.delayedCall(n * 0.08, () => e.target._play.play());
    });
  }, { rootMargin: "0px 0px -6% 0px" });
  box.querySelectorAll(".row").forEach((row) => {
    const clear = "transform,opacity,visibility";
    const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
    tl.from(row, { autoAlpha: 0, y: 18, duration: 0.8, clearProps: clear });
    const band = row.querySelector(".band"), dots = row.querySelectorAll(".dot, .edge"), num = row.querySelector("[data-n]");
    if (band) tl.from(band, { scaleX: 0, duration: 1.2, ease: "expo.out", clearProps: clear }, 0.15);
    tl.from(row.querySelector(".med"), { scaleY: 0, duration: 0.7, ease: "back.out(2)", clearProps: clear }, 0.3);
    if (dots.length) {
      tl.from(dots, { scale: 0, autoAlpha: 0, duration: 0.5, ease: "back.out(2.6)", clearProps: clear,
        stagger: Math.min(0.035, 0.7 / dots.length) }, 0.35);
    }
    const end = Number(num.dataset.n), n = { v: 0 };
    tl.to(n, { v: end, duration: 1.3, ease: "power2.out", onUpdate: () => { num.textContent = fmt(n.v); } }, 0.15);
    row._play = tl;
    watcher.observe(row);
  });
}

let resizing = 0;
addEventListener("resize", () => { clearTimeout(resizing); resizing = setTimeout(spreadDots, 150); });

/** Counts a number up from 0, keeping how it's written ("2.5", "1,204"). */
function countUp(el) {
  const text = el.textContent, end = parseFloat(text.replace(/,/g, "")), decimals = (text.split(".")[1] || "").length;
  if (!motion() || !(end > 0)) return;
  const n = { v: 0 };
  el.textContent = "0";
  gsap.to(n, { v: end, duration: 1.8, delay: 0.35, ease: "power3.out",
    onUpdate: () => { el.textContent = decimals ? n.v.toFixed(decimals) : fmt(n.v); },
    onComplete: () => { el.textContent = text; } });
}

// ---------------------------------------------------------------- the bar at the top
// The latest runs players shared, one at a time (the server picks them: one per player,
// nothing unusual). Clicking one shows the best maps for that level, class and party.

let news = [], newsAt = 0, newsHeld = false;
const ago = (iso) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 2 ? "刚刚" : min < 60 ? `${min} 分钟前` : min < 36 * 60 ? `${Math.round(min / 60)} 小时前`
    : `${Math.round(min / 1440)} 天前`;
};
const jobName = (job) => job.replace(" (Fire,Poison)", " (F/P)").replace(" (Ice,Lightning)", " (I/L)");

function newsItem(r) {
  const party = r.party > 1 ? `${Number(r.party)} 人队伍` : "单人";
  const level = Number(r.level), size = Number(r.party);
  return `<button type="button" data-level="${level}" data-party="${size}" data-job="${esc(r.job)}"
    title="查看 Lv ${level} ${esc(jobName(r.job))}（${size > 1 ? "组队" : "单人"}）的最佳地图">` +
    `<b>Lv ${level} ${esc(jobName(r.job))}</b><span class="says"> 获得</span> · <span class="x"><span class="n-full">${fmt(r.exp_hr)}</span><span class="n-short">${compact(r.exp_hr)}</span> 经验/小时</span> · ` +
    `<b class="m">${esc(r.map)}</b><span class="p"> · ${party}</span> · <span class="ago">${ago(r.shared)}</span></button>`;
}

/** The next run slides up into the bar (or just appears, without motion). */
function nextNews(first = false) {
  const box = $("ticker"), old = [...box.children];
  box.insertAdjacentHTML("beforeend", newsItem(news[newsAt % news.length]));
  const el = box.lastElementChild;
  if (motion() && !first) {
    gsap.fromTo(el, { yPercent: 90, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.8, ease: "expo.out" });
    gsap.to(old, { yPercent: -90, autoAlpha: 0, duration: 0.45, ease: "power2.in", onComplete: () => old.forEach((o) => o.remove()) });
  } else {
    old.forEach((o) => o.remove());
    if (motion()) gsap.from(el, { autoAlpha: 0, duration: 0.8, delay: 0.4, ease: "power2.out" });
  }
}

async function loadNews() {
  let data = null;
  try { data = await (await fetch("/api/recent", { cache: "no-store" })).json(); } catch {}
  if (!data?.runs) return;
  if (!data.runs.length) {
    if (!news.length) $("news").hidden = true;            // nothing shared yet
    return;
  }
  const first = !news.length;
  news = data.runs;
  if (first) {
    newsAt = 0;
    $("news-more").textContent = "点击一条查看其最佳地图";
    nextNews(true);
  }
}

$("ticker").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-job]");
  if (!b || !classes.length) return;
  const want = fromLink(new URLSearchParams({ level: b.dataset.level, party: b.dataset.party, job: b.dataset.job }));
  if (want.level) $("level").value = want.level;
  if (want.party) $("party").value = want.party;
  wantPath = want.path || null;
  pickClass(want.job);
  ask(null, true);
});
for (const [on, held] of [["pointerenter", true], ["pointerleave", false], ["focusin", true], ["focusout", false]]) {
  $("news").addEventListener(on, () => { newsHeld = held; });
}
setInterval(() => {                       // a new one every 5 seconds, unless you're on it
  if (news.length > 1 && !newsHeld && !document.hidden) { newsAt++; nextNews(); }
}, 5000);
// The latest runs are asked for only while the page is on screen, and at most every 5 minutes: a tab
// left open in the background must not keep calling the server all day (each call counts toward the
// free plan's daily limit).
const NEWS_EVERY = 5 * 60 * 1000;
let newsAsked = 0;
function refreshNews() {
  if (document.hidden || Date.now() - newsAsked < NEWS_EVERY) return;
  newsAsked = Date.now();
  loadNews();
}
setInterval(refreshNews, 30000);
document.addEventListener("visibilitychange", refreshNews);   // back on the tab: catch up
refreshNews();

// "Coming next": shown unless the visitor closed this exact list (saved in their browser; a changed list shows again).
{
  const box = $("next");
  const key = "next:" + [...box.querySelectorAll("li")].map((li) => li.textContent.trim()).join("|");
  let closed = false;
  try { closed = localStorage.getItem("nextClosed") === key; } catch {}
  box.hidden = closed;
  $("next-x").addEventListener("click", () => {
    box.hidden = true;
    try { localStorage.setItem("nextClosed", key); } catch {}
  });
}

// The hero: the headline rises into place line by line, the rest fades up.
if (motion()) {
  const clear = "transform,opacity,visibility";
  gsap.timeline({ defaults: { ease: "expo.out", duration: 1.2 } })
    .from(".hero .eyebrow", { autoAlpha: 0, y: 10, clearProps: clear })
    .from(".hero h1 .ln > span", { yPercent: 110, duration: 1.3, stagger: 0.1, clearProps: "transform" }, 0.05)
    .from(".hero p.sub, .counts", { autoAlpha: 0, y: 16, stagger: 0.1, clearProps: clear }, 0.3)
    .from(".finder", { autoAlpha: 0, y: 28, duration: 1.4, clearProps: clear }, 0.2);
}
document.documentElement.classList.remove("anim");

$("classes").addEventListener("change", (e) => pickClass(e.target.value));
$("path").addEventListener("change", () => { wantPath = $("path").value; showSteps(); });
$("level").addEventListener("input", () => { if (!isNaN(parseInt($("level").value, 10))) fillPaths(); });
$("ask").addEventListener("submit", ask);
loadOptions();
