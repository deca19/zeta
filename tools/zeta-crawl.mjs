// 🛰 제타 탐사봇 v5 — 제타(zeta-ai.io) 공개 작품 페이지를 천천히 돌며 인기 공식을 분석해요.
// · 누적 학습: 읽은 작품을 data/zeta-bank.json에 계속 쌓고, 인기 공식은 쌓인 전체로 다시 계산
// · 매번 안 읽은 작품을 먼저 읽고, 7일 지난 작품은 다시 읽어 실제 성장 속도를 잼
// · robots.txt 허용 범위(공개 페이지)만, 요청 사이 2.5초 쉬기, 한 번에 최대 MAX개
// · 태그·소개에 노골적인 성적 표현이 있는 작품은 건너뜀 (언리밋 표시만으로는 제외 안 함)
// · 다른 작가의 글은 짧은 발췌만 저장 (전문은 저장하지 않음)
// · 진행 상황은 ntfy.sh로 실시간 중계 → 제타 스튜디오 앱에서 볼 수 있어요
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

const BASE = "https://zeta-ai.io", LANG = "ko";
const UA = "Mozilla/5.0 (compatible; ZetaStudioBot/1.0; +https://deca19.github.io/zeta/)";
const MAX = Math.max(5, Math.min(60, +(process.env.MAX || 36)));
const DELAY = 2500;
const TOPIC = process.env.NTFY_TOPIC || "zeta-studio-deca19-live-7f3k2";
const RUN = process.env.GITHUB_RUN_ID || String(Date.now());
const t0 = Date.now();
const log = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function say(type, msg, extra = {}){
  const e = { run: RUN, t: Date.now() - t0, type, msg, ...extra };
  log.push(e);
  console.log(`[${(e.t / 1000).toFixed(1)}s] ${msg}`);
  // 중계 서버가 바쁘면(429) 한 번 쉬었다가 다시 보냄
  for (let tryN = 0; tryN < 2; tryN++){
    try { const r = await fetch(`https://ntfy.sh/${TOPIC}`, { method: "POST", body: JSON.stringify(e) }); if (r.status !== 429) break; } catch { break; }
    await sleep(5500);
  }
}

/* ---------- Next.js(RSC) 페이지에서 데이터 꺼내기 ---------- */
function rsc(html){
  let out = "";
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g; let m;
  while ((m = re.exec(html))){ try { out += JSON.parse('"' + m[1] + '"'); } catch {} }
  return out;
}
function objsWith(s, key){
  const res = []; let i = 0;
  while ((i = s.indexOf(`"${key}"`, i)) >= 0){
    let depth = 0, j = i;
    for (; j > 0; j--){ const c = s[j]; if (c === "}") depth++; else if (c === "{"){ if (depth === 0) break; depth--; } }
    let k = j, ins = false, esc = false; depth = 0;
    for (; k < s.length; k++){
      const c = s[k];
      if (ins){ if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') ins = false; }
      else if (c === '"') ins = true; else if (c === "{") depth++; else if (c === "}"){ depth--; if (depth === 0) break; }
    }
    try { res.push(JSON.parse(s.slice(j, k + 1))); } catch {}
    i = Math.max(k, i + 1);
  }
  return res;
}
async function get(url){
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}

/* ---------- 분석 도구 ---------- */
// 언리밋 표시는 '성인 인증 유저가 더 자유로운 모드로도 할 수 있음'이라는 뜻일 뿐, 작품 자체는 모두에게 공개된 일반 작품이라 제외하지 않음.
// 대신 태그·소개에 노골적인 성적 표현이 있는 작품만 건너뜀.
const ADULT_TAG = /절륜|문란|19금|^19$|성인용|음란|야한|야설|수위|섹시|섹스|육덕|변태|노출|r-?18|nsfw|더티톡|베드신|원나잇|후방주의/i;
const isUnlimited = p => (p.hashtags || []).some(t => ADULT_TAG.test(String(t).trim())) || /섹스|절륜|음란|19금/.test(String(p.shortDescription || ""));
const hasUnlimitedBadge = p => !!p.showUnlimitedBadge || (p.hashtags || []).some(t => /언리밋|unlimited/i.test(String(t)));
const GENRES = {
  "로맨스": ["로맨스","순애","연애","hl","nl","설렘"], "BL·GL": ["bl","gl"], "집착·광기": ["집착","광기","얀데레","소유욕"],
  "판타지": ["판타지","마법","기사","용사","마왕","제국","아카데미"], "로판·회귀": ["로판","회귀","악녀","빙의","환생"],
  "학원": ["학교","학원","고등학생","대학생","전학생","일진"], "조직·느와르": ["조직","보스","마피아","조직보스"],
  "수인·이종족": ["수인","고양이","늑대","용","뱀파이어"], "코미디": ["코미디","개그","병맛","코믹"],
  "현대·일상": ["일상","현대","직장","회사","옆집"], "히어로·능력": ["히어로","빌런","초능력","능력자"], "다인캐": ["다인캐","남녀무리","무리"],
  "TS": ["ts","성전환"], "혐관·후회": ["혐관","후회","이혼"],
};
function genresOf(tags){ const t = tags.map(x => String(x).toLowerCase()); return Object.keys(GENRES).filter(g => GENRES[g].some(k => t.some(x => x.includes(k)))); }
const plain = s => String(s || "").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = plain(s); return s.length > n ? s.slice(0, n) + "…" : s; };
function ratio(text, re){ const t = String(text || ""); if (!t) return 0; return (t.match(re) || []).join("").length / t.length; }

function analyze(p, rank){
  const intro = ((p.intros && p.intros[0] && p.intros[0].conversation && p.intros[0].conversation.messages) || []).filter(m => m.type !== "image").map(m => m.content || "").join("\n");
  const long = p.isLongDescriptionPublic === false ? "" : (p.longDescription || "");
  const chars = p.characters || [];
  const convs = (p.isExampleConversationPublic === false ? [] : (p.conversations || []));
  const released = Date.parse(p.releasedAt || p.createdAt || "") || Date.now();
  const ageDays = Math.max(1, (Date.now() - released) / 86400000);
  const count = +p.interactionCount || 0;
  const tail = plain(intro).slice(-60);
  const f = {
    shortLen: plain(p.shortDescription).length,
    introLen: plain(intro).length,
    longLen: plain(long).length,
    charCount: chars.length,
    charDescLen: chars.length ? Math.round(chars.reduce((s, c) => s + plain(c.description).length, 0) / chars.length) : 0,
    exampleConvs: convs.length,
    lorebooks: (p.lorebooks || []).length,
    tagCount: (p.hashtags || []).length,
    introNarration: Math.round(ratio(intro, /\*[^*]{1,800}\*/g) * 100),
    introDialogue: (() => { const q = ratio(intro, /"[^"]{1,300}"|“[^”]{1,300}”/g); if (q > 0) return Math.round(q * 100);
      const rest = String(intro).replace(/\*[^*]{1,800}\*/g, "").replace(/\s+/g, ""); return intro ? Math.round(rest.length / String(intro).replace(/\s+/g, "").length * 100) : 0; })(),
    introEndsOpen: /[?？…]|\{\{user\}\}|Guest|당신|너/.test(tail) ? 1 : 0,
    userMention: ((intro + long).match(/\{\{user\}\}|Guest/g) || []).length,
    commentLen: plain(p.creatorComment).length,
    plugins: (p.plugins || []).length,
    ageDays: Math.round(ageDays),
    perDay: Math.round(count / ageDays),
  };
  // 공개 부분 기준 히트 점수 (앱의 진단과 같은 기준)
  let hook = 0; const sd = plain(p.shortDescription);
  if (sd){ hook += 4; hook += sd.length <= 70 ? 4 : sd.length <= 120 ? 2 : 0; hook += /[?!…]/.test(sd) ? 3 : 0; hook += /비밀|계약|정체|들키|되어|버렸|회귀|이혼|저주|사냥|도망|후회/.test(sd) ? 4 : 0; }
  let open = 0;
  if (intro){ open += f.introLen >= 300 && f.introLen <= 1000 ? 6 : f.introLen >= 150 ? 3 : 1; open += f.introNarration ? 4 : 0; open += f.introDialogue ? 4 : 0; open += f.introEndsOpen ? 6 : 2; }
  const score = Math.round((Math.min(15, hook) + Math.min(20, open) + Math.min(10, f.userMention * 2)) / 45 * 100);
  return {
    id: p.id, url: `${BASE}/${LANG}/plots/${p.id}/profile`,
    name: plain(p.name), creator: (p.creator && (p.creator.nickname || p.creator.username)) || "",
    count, rank: rank || null, tags: (p.hashtags || []).slice(0, 12).map(String), genres: genresOf(p.hashtags || []),
    short: clip(p.shortDescription, 120), introExcerpt: clip(intro, 160), longExcerpt: clip(long, 120),
    charNames: chars.slice(0, 6).map(c => plain(c.name)).filter(Boolean),
    mode: p.mode || "", unlimited: hasUnlimitedBadge(p), releasedAt: p.releasedAt || p.createdAt || "", f, score,
  };
}

/* ---------- 순위 상관 ---------- */
function ranks(a){ const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let k = 0; while (k < idx.length){ let j = k; while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++; for (let t = k; t <= j; t++) r[idx[t][1]] = (k + j) / 2; k = j + 1; } return r; }
function corr(x, y){ const n = x.length; if (n < 3) return 0; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let c = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++){ c += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx && sy ? c / Math.sqrt(sx * sy) : 0; }
const FEAT_LABEL = { shortLen:"한 줄 소개 길이", introLen:"인트로(첫 메시지) 길이", longLen:"상세 설명 길이", charCount:"캐릭터 수", charDescLen:"캐릭터 설정 길이", exampleConvs:"예시 대화 수", lorebooks:"공개 로어북 수", tagCount:"태그 수", introDialogue:"인트로 대사 비중(%)", introNarration:"인트로 묘사 비중(%)", introEndsOpen:"인트로가 유저에게 넘기며 끝남", userMention:"유저 언급 수", commentLen:"작가 코멘트 길이", plugins:"부가 기능 수" };
function aggregate(works){
  const pop = works.map(w => Math.log10(1 + w.count)), pr = ranks(pop);
  const sorted = [...works].sort((a, b) => b.count - a.count), half = Math.ceil(works.length / 2), top = sorted.slice(0, half), bot = sorted.slice(half);
  const avg = (arr, k) => arr.length ? Math.round(arr.reduce((s, w) => s + w.f[k], 0) / arr.length * 10) / 10 : 0;
  const feats = Object.keys(FEAT_LABEL).map(k => ({ k, label: FEAT_LABEL[k], c: Math.round(corr(ranks(works.map(w => w.f[k])), pr) * 100) / 100, topAvg: avg(top, k), botAvg: avg(bot, k) }))
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  const tagCount = {}, tagTop = {}, genreCount = {}, genreTop = {};
  works.forEach(w => w.tags.forEach(t => { const x = t.toLowerCase(); tagCount[x] = (tagCount[x] || 0) + 1; }));
  top.forEach(w => w.tags.forEach(t => { const x = t.toLowerCase(); tagTop[x] = (tagTop[x] || 0) + 1; }));
  works.forEach(w => w.genres.forEach(g => genreCount[g] = (genreCount[g] || 0) + 1));
  top.forEach(w => w.genres.forEach(g => genreTop[g] = (genreTop[g] || 0) + 1));
  // 급상승: 두 번 이상 재서 실제로 늘어난 속도가 있으면 그걸로, 아니면 출시 후 하루 평균으로
  const measured = works.filter(w => w.growth > 0);
  const rising = (measured.length >= 6 ? measured.sort((a, b) => b.growth - a.growth) : [...works].filter(w => w.f.ageDays <= 45).sort((a, b) => b.f.perDay - a.f.perDay)).slice(0, 8).map(w => w.id);
  return {
    n: works.length, feats,
    tags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 25),
    tagsTop: Object.entries(tagTop).sort((a, b) => b[1] - a[1]).slice(0, 15),
    genres: Object.entries(genreCount).sort((a, b) => b[1] - a[1]),
    genresTop: Object.entries(genreTop).sort((a, b) => b[1] - a[1]),
    rising, risingBy: measured.length >= 6 ? "measured" : "perDay",
    medianCount: sorted.length ? sorted[Math.floor(sorted.length / 2)].count : 0,
  };
}

/* ---------- 누적 학습 창고 ---------- */
const BANK_FILE = "data/zeta-bank.json", BANK_MAX = 1500, FRONTIER_MAX = 400, OBS_MAX = 24, SKIP_DAYS = 30;
const today = new Date().toISOString().slice(0, 10);
const readJSON = f => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; } };
const prevTrends = readJSON("data/zeta-trends.json");
let bank = readJSON(BANK_FILE);
if (!bank || !bank.works || typeof bank.works !== "object"){
  bank = { since: today, runs: 0, works: {}, frontier: {}, skip: {} };
  // 예전 버전 결과가 있으면 첫 기억으로 옮겨 담기
  const day = String((prevTrends && prevTrends.updatedAt) || today).slice(0, 10);
  for (const w of (prevTrends && prevTrends.works) || []) if (w && w.id) bank.works[w.id] = { ...w, first: day, last: day, seen: 1, obs: [[day, w.count]] };
}
bank.frontier = bank.frontier || {}; bank.skip = bank.skip || {};
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
for (const [id, d] of Object.entries(bank.skip)) if (daysBetween(d, today) > SKIP_DAYS) delete bank.skip[id];
// 0 = 처음 보는 작품, 1 = 7일 넘게 안 읽은 작품(다시 재기), 2 = 최근에 읽은 작품
const priority = id => { const b = bank.works[id]; return !b ? 0 : daysBetween(b.last, today) >= 7 ? 1 : 2; };
const growthOf = b => { const o = b.obs || []; if (o.length < 2) return null; const d = daysBetween(o[0][0], o[o.length - 1][0]); return d >= 1 ? Math.round((o[o.length - 1][1] - o[0][1]) / d) : null; };

/* ---------- 탐사 시작 ---------- */
await say("start", `🛰 제타 탐사 시작 — 최대 ${MAX}개 작품을 천천히 읽어요`, { max: MAX });
const cards = new Map();   // id → { name, count, rank }
const blocked = new Set();
const addCards = (s, fromRank) => {
  let n = 0;
  for (const o of objsWith(s, "interactionCount")){
    if (!o || !o.id || !o.name || bank.skip[o.id]) continue;
    if (isUnlimited(o)){ blocked.add(o.id); continue; }
    const c = cards.get(o.id);
    const rank = fromRank && o.rank ? +o.rank : (c && c.rank) || null;
    if (!c){ cards.set(o.id, { name: o.name, count: +o.interactionCount || 0, rank }); n++; }
    else if (rank && !c.rank) c.rank = rank;
  }
  return n;
};
for (const [label, path, isRank] of [["홈", `/${LANG}`, false], ["랭킹", `/${LANG}?tab=ranking`, true]]){
  try {
    await say("visit", `🚪 제타 ${label} 화면에 들어가는 중…`, { url: BASE + path });
    const n = addCards(rsc(await get(BASE + path)), isRank);
    await say("list", `📋 ${label}에서 작품 ${n}개 발견 (성인 태그 작품 제외)`, { found: n, total: cards.size });
  } catch(e){ await say("error", `⚠ ${label} 화면 읽기 실패: ${e.message}`); }
  await sleep(DELAY);
}
// 탐사의 1/4은 7일 넘게 안 읽은 인기작을 다시 읽어 '실제로 얼마나 늘었는지' 잼
const REFRESH = Math.ceil(MAX / 4);
for (const b of Object.values(bank.works).filter(b => daysBetween(b.last, today) >= 7).sort((a, b) => b.count - a.count).slice(0, REFRESH))
  if (!cards.has(b.id)) cards.set(b.id, { name: b.name, count: b.count, rank: null });
{ let n = 0;
  for (const [id, c] of Object.entries(bank.frontier)) if (!cards.has(id) && !bank.works[id] && !bank.skip[id]){ cards.set(id, { name: c.name, count: +c.count || 0, rank: null }); n++; }
  const known = Object.keys(bank.works).length;
  await say("list", `🧠 지금까지 ${known}개 작품을 학습함${n ? ` · 지난번에 찾아둔 안 읽은 작품 ${n}개도 후보에 넣음` : ""} → 처음 보는 작품부터 읽어요`, { known, total: cards.size }); }
const done = new Set(), works = [];
let skipped = 0, refreshed = 0;
function pick(){
  const cand = [...cards.entries()].filter(([id]) => !done.has(id));
  if (refreshed < REFRESH && works.length % 4 === 3){
    const st = cand.filter(([id]) => priority(id) === 1).sort((a, b) => b[1].count - a[1].count)[0];
    if (st) return st;
  }
  return cand.sort((a, b) => priority(a[0]) - priority(b[0]) || b[1].count - a[1].count)[0];
}
while (works.length < MAX){
  const next = pick();
  if (!next) break;
  const [id, card] = next; done.add(id);
  const url = `${BASE}/${LANG}/plots/${id}/profile`;
  console.log(`📖 [${works.length + 1}/${MAX}] 「${card.name}」 읽는 중…`);
  try {
    const s = rsc(await get(url));
    const p = objsWith(s, "intros").find(o => o.id === id) || objsWith(s, "interactionCountWithRegen").find(o => o.id === id);
    if (!p){ bank.skip[id] = today; await say("skip", "⏭ 공개 정보가 없어 건너뜀"); continue; }
    if (isUnlimited(p)){ skipped++; bank.skip[id] = today; await say("skip", "⏭ 성인 태그 작품이라 건너뜀"); continue; }
    if (p.language && p.language !== "KOREAN"){ bank.skip[id] = today; await say("skip", "⏭ 한국어 작품이 아니라 건너뜀"); continue; }
    const w = analyze(p, card.rank);
    w.isNew = !bank.works[id];
    if (priority(id) === 1) refreshed++;
    works.push(w);
    const added = addCards(s, false);
    await say("work", `📖 [${works.length}/${MAX}] 「${w.name}」 (💬 ${w.count.toLocaleString("ko-KR")}) — 점수 ${w.score} · 인트로 ${w.f.introLen}자 · ${w.tags.slice(0, 4).map(t => "#" + t).join(" ")}${w.unlimited ? " · ★언리밋" : ""}${w.isNew ? " · 🆕" : bank.works[id] ? ` · 다시 잼 (${(w.count >= bank.works[id].count ? "+" : "") + (w.count - bank.works[id].count).toLocaleString("ko-KR")})` : ""}${added ? ` · 연관작 +${added}` : ""}`, { work: w, i: works.length, max: MAX });
  } catch(e){ await say("error", `⚠ 「${card.name}」 읽기 실패: ${e.message}`); }
  await sleep(DELAY);
}
/* ---------- 창고에 쌓고, 쌓인 전체로 공식 다시 계산 ---------- */
let fresh = 0;
for (const w of works){
  const b = bank.works[w.id];
  if (!b) fresh++;
  const { isNew, ...keep } = w;
  const obs = ((b && b.obs) || []).filter(o => o[0] !== today).concat([[today, w.count]]).slice(-OBS_MAX);
  bank.works[w.id] = { ...keep, first: (b && b.first) || today, last: today, seen: ((b && b.seen) || 0) + 1, obs };
}
for (const id of done) delete bank.frontier[id];
for (const [id, c] of cards) if (!done.has(id) && !bank.works[id] && !bank.skip[id]) bank.frontier[id] = { name: c.name, count: c.count };
const trim = (obj, max, key) => { const e = Object.entries(obj); if (e.length > max){ e.sort(key).slice(max).forEach(([id]) => delete obj[id]); } };
trim(bank.frontier, FRONTIER_MAX, (a, b) => (b[1].count || 0) - (a[1].count || 0));
trim(bank.works, BANK_MAX, (a, b) => String(b[1].last).localeCompare(String(a[1].last)) || b[1].count - a[1].count);
trim(bank.skip, 3000, (a, b) => String(b[1]).localeCompare(String(a[1])));
bank.runs = (bank.runs || 0) + 1; bank.updatedAt = new Date().toISOString();

const all = Object.values(bank.works).map(b => { const { obs, ...w } = b; return { ...w, growth: growthOf(b) }; });
const stats = aggregate(all);
const best = stats.feats.filter(f => Math.abs(f.c) >= 0.3).slice(0, 3).map(f => `${f.label} ${f.c > 0 ? "↑" : "↓"}`).join(", ");
await say("done", `🏁 탐사 끝 — 이번에 ${works.length}개 읽음 (새 작품 ${fresh}개${refreshed ? ` · 다시 잰 작품 ${refreshed}개` : ""} · 성인 태그 ${blocked.size + skipped}개 제외) · 누적 ${all.length}개로 공식 다시 계산${best ? " · 인기와 관련 큰 요소: " + best : ""}`, { n: works.length, bank: all.length, fresh });

const byCount = [...all].sort((a, b) => b.count - a.count);
const top = byCount.slice(0, 60);
for (const id of stats.rising) if (!top.some(w => w.id === id)){ const w = all.find(x => x.id === id); if (w) top.push(w); }
const thin = w => { const { obs, isNew, ...x } = w; return x; };
mkdirSync("data", { recursive: true });
const history = ((prevTrends && prevTrends.history) || []).concat([{ at: new Date().toISOString(), n: works.length, bank: all.length, fresh,
  feats: stats.feats.slice(0, 4).map(f => [f.k, f.c]) }]).slice(-60);
writeFileSync(BANK_FILE, JSON.stringify(bank));
writeFileSync("data/zeta-trends.json", JSON.stringify({ updatedAt: new Date().toISOString(), run: RUN, topic: TOPIC,
  works: works.map(thin), top: top.map(thin), stats,
  bank: { n: all.length, fresh, runs: bank.runs, since: bank.since, frontier: Object.keys(bank.frontier).length },
  log, history }, null, 1));
console.log("saved", works.length, "bank", all.length, "fresh", fresh);
