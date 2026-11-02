"use strict";
/* =====================================================================
   🛰 제타 탐사 — 탐사봇이 제타 공개 작품을 읽고 분석하는 걸 실시간으로 보기
   · 실시간 중계: ntfy.sh 채널 (탐사봇이 한 걸음마다 소식을 보냄)
   · 결과: GitHub 저장소의 data/zeta-trends.json
   · 언리밋(성인 모드) 작품은 탐사봇이 처음부터 건너뜀
   ===================================================================== */
const EXP = {
  repo: "deca19/zeta",
  topic: "zeta-studio-deca19-live-7f3k2",
  workflow: "zeta-crawl.yml",
  data: null, loading: null, es: null, feed: [], live: null, replayT: null,
};
const EXP_ACTIONS_URL = `https://github.com/${EXP.repo}/actions/workflows/${EXP.workflow}`;
// 앱에서도 한 번 더 거름 (탐사봇과 같은 기준)
const EXP_ADULT = /언리밋|unlimited|절륜|문란|19금|^19$|성인|음란|야한|야설|수위|섹시|섹스|육덕|변태|노출|r-?18|nsfw|더티|베드신|원나잇|임신|후방주의/i;
const expSafe = w => w && !(w.tags || []).some(t => EXP_ADULT.test(String(t).trim()));

async function expLoad(force){
  if (EXP.data && !force) return EXP.data;
  if (EXP.loading) return EXP.loading;
  EXP.loading = (async () => {
    const tries = [
      () => fetch(`https://api.github.com/repos/${EXP.repo}/contents/data/zeta-trends.json?ref=main&t=${Date.now()}`, { headers:{ Accept:"application/vnd.github.raw+json" } }),
      () => fetch(`data/zeta-trends.json?t=${Date.now()}`),
    ];
    for (const t of tries){
      try { const r = await t(); if (r.ok){ const d = await r.json(); if (d && Array.isArray(d.works)){ d.works = d.works.filter(expSafe); (d.log || []).forEach(e => { if (e.work && !expSafe(e.work)) delete e.work; }); EXP.data = d; return d; } } } catch(e){}
    }
    return null;
  })();
  try { return await EXP.loading; } finally { EXP.loading = null; }
}

/* ---------- 실시간 중계 ---------- */
function expHandle(ev, view){
  let e; try { e = typeof ev === "string" ? JSON.parse(ev) : ev; } catch(_){ return; }
  if (!e || !e.msg) return;
  if (EXP.feed.length && EXP.feed[EXP.feed.length - 1].msg === e.msg && EXP.feed[EXP.feed.length - 1].t === e.t) return;
  if (e.type === "start"){ EXP.feed = []; EXP.live = { run: e.run, max: e.max || 0, i: 0, cur: null, done: false }; }
  EXP.live = EXP.live || { run: e.run, max: 0, i: 0, cur: null, done: false };
  if (e.type === "visit" && e.i) EXP.live.i = e.i;
  if (e.work && !expSafe(e.work)) delete e.work;
  if (e.type === "work" && e.work) EXP.live.cur = e.work;
  if (e.type === "done"){ EXP.live.done = true; setTimeout(() => expLoad(true).then(() => view && view.refresh && view.refresh()), 8000); }
  EXP.feed.push(e); if (EXP.feed.length > 200) EXP.feed.shift();
  view && view.push && view.push(e);
}
function expConnect(view){
  if (EXP.es) return;
  // 진행 중인 탐사가 있으면 최근 소식부터 따라잡기
  fetch(`https://ntfy.sh/${EXP.topic}/json?poll=1&since=20m`).then(r => r.ok ? r.text() : "").then(t => {
    t.trim().split("\n").filter(Boolean).forEach(l => { try { const m = JSON.parse(l); if (m.event === "message") expHandle(m.message, view); } catch(e){} });
  }).catch(() => {});
  try {
    const es = new EventSource(`https://ntfy.sh/${EXP.topic}/sse`);
    es.onmessage = m => { try { const d = JSON.parse(m.data); if (d.event === "message") expHandle(d.message, view); } catch(e){} };
    es.onerror = () => { view && view.status && view.status("📡 중계 연결이 끊겼어요 — 자동으로 다시 붙어요"); };
    es.onopen = () => { view && view.status && view.status("📡 실시간 중계 연결됨 — 탐사가 시작되면 여기에 바로 보여요"); };
    EXP.es = es;
  } catch(e){ view && view.status && view.status("⚠ 이 브라우저는 실시간 중계를 못 받아요"); }
}

/* ---------- 탐사 시작 (깃허브 키가 있으면 바로, 없으면 깃허브 화면으로) ---------- */
async function expStart(max){
  const tok = (getKeys().github || "").trim();
  if (!tok){ window.open(EXP_ACTIONS_URL, "_blank", "noopener"); toast("깃허브에서 'Run workflow'를 누르면 탐사가 시작돼요"); return; }
  try {
    const r = await fetch(`https://api.github.com/repos/${EXP.repo}/actions/workflows/${EXP.workflow}/dispatches`, {
      method:"POST", headers:{ Authorization:"Bearer " + tok, Accept:"application/vnd.github+json", "Content-Type":"application/json" },
      body: JSON.stringify({ ref:"main", inputs:{ max: String(max || 36) } }) });
    if (r.status === 204){ toast("🛰 탐사봇 출발! 10~20초 뒤부터 중계가 보여요"); return true; }
    const t = await r.text();
    toast(r.status === 401 || r.status === 403 ? "⚠ 깃허브 키 권한이 부족해요 (Actions 쓰기 권한 필요)" : r.status === 404 ? "⚠ 탐사봇이 아직 설치되지 않았어요" : "⚠ 시작 실패 " + r.status + ": " + t.slice(0, 80));
  } catch(e){ toast(inClaudeApp() ? "Claude 앱 안에서는 안 돼요 — 내 사이트에서 열어 주세요" : "⚠ 깃허브에 연결하지 못했어요"); }
  return false;
}

/* ---------- 내 작품을 같은 기준으로 재기 ---------- */
function myFeats(w){
  const F = k => (w.fields[k] || "").trim();
  const intro = F("first"), tail = intro.replace(/\s+/g, " ").slice(-60);
  const nar = (intro.match(/\*[^*]{1,800}\*/g) || []).join("").length / Math.max(1, intro.length);
  return {
    shortLen: F("intro").replace(/\s+/g, " ").length,
    introLen: intro.replace(/\s+/g, " ").length,
    longLen: ["world","situation","relation"].map(F).join(" ").replace(/\s+/g, " ").length,
    charDescLen: ["look","personality","speech"].map(F).join(" ").replace(/\s+/g, " ").length,
    exampleConvs: (F("example").match(/\{\{char\}\}\s*[:：]/g) || []).length,
    lorebooks: w.lore.filter(x => x.on).length,
    introNarration: Math.round(nar * 100),
    introEndsOpen: /[?？…]|\{\{user\}\}|당신|너/.test(tail) ? 1 : 0,
    userMention: ((intro + F("world") + F("situation")).match(/\{\{user\}\}/g) || []).length,
  };
}
function expToRef(x){
  const r = blankWork(x.name, { ref:true, author: x.creator || "", pop:{ chats: x.count || 0, likes: 0 }, zetaId: x.id, url: x.url });
  r.fields = { name: x.name, intro: x.short || "", first: x.introExcerpt || "", world: x.longExcerpt || "" };
  return r;
}
function expAddRefs(list){
  S.refs = S.refs || [];
  let n = 0;
  for (const x of list){ if (S.refs.some(r => r.zetaId === x.id || (r.name === x.name && r.author === x.creator))) continue; S.refs.push(expToRef(x)); n++; }
  save(); return n;
}
function expTrendPrompt(d){
  const ws = [...d.works].sort((a, b) => b.count - a.count).slice(0, 30);
  const st = d.stats || {};
  const strong = (st.feats || []).filter(f => Math.abs(f.c) >= 0.3).map(f => `${f.label} ${f.c > 0 ? "많을수록" : "적을수록"} 인기 (인기작 평균 ${f.topAvg})`).join(", ");
  return `아래는 제타(AI 캐릭터 채팅)에서 지금 인기 있는 작품 ${ws.length}개의 공개 정보야 (대화 수 순, 언리밋·성인 태그 제외).
다음을 분석해줘:
■ 지금 제타에서 먹히는 소재·장르·관계 공식 TOP 5 (근거 작품 이름과 함께)
■ 클릭을 부르는 이름·한 줄 소개 패턴
■ 인트로(첫 메시지) 패턴
■ 아직 비어 있는 틈새 (경쟁이 덜한 조합)
■ 내 작품 《${W().name}》에 바로 쓸 수 있는 개선안 3가지
다른 작가의 문장을 베끼지 말고 원리만 써.

[통계] ${strong || "뚜렷한 상관 없음"}
자주 나온 태그: ${(st.tags || []).slice(0, 15).map(t => "#" + t[0]).join(" ")}

[작품들]
${ws.map((w, i) => `${i + 1}. 《${w.name}》 대화 ${fmtNum(w.count)} · ${w.tags.slice(0, 6).map(t => "#" + t).join(" ")}\n   소개: ${w.short}\n   인트로: ${w.introExcerpt}`).join("\n")}`;
}

/* ---------- 화면 ---------- */
VIEWS.explore = (body) => {
  S.expTab = S.expTab || "live";
  const tabs = h("div", { class:"tabs" }), box = h("div");
  const drawTabs = () => tabs.replaceChildren(...[["live","🔴 실시간 탐사"],["result","📊 탐사 결과"],["formula","🧠 인기 공식"]].map(([k, t]) => h("button", { class:"pill" + (S.expTab === k ? " on" : ""), onclick:() => { S.expTab = k; save(); drawTabs(); draw(); } }, t)));
  function draw(){ clearTimeout(EXP.replayT); box.replaceChildren(); (S.expTab === "live" ? expLive : S.expTab === "result" ? expResult : expFormula)(box); }
  if (inClaudeApp()) body.append(h("div", { class:"warnbox", style:"margin-bottom:10px" }, "⚠ Claude 앱 안에서는 탐사 중계·결과를 못 불러와요. ", h("a", { href: SITE_URL + "#explore", target:"_blank", rel:"noopener", style:"color:inherit" }, "내 사이트에서 열기 ↗")));
  body.append(tabs, box); drawTabs(); draw();
};
function expLive(box){
  const statusEl = h("div", { class:"tiny", style:"margin-bottom:6px" }, "📡 중계 연결 중…");
  const term = h("div", { style:"background:#07060a;border:1px solid var(--line);border-radius:12px;padding:10px 12px;height:260px;overflow:auto;font-size:12.5px;line-height:1.65;font-family:ui-monospace,Menlo,monospace" });
  const prog = h("div", { class:"prog" }, h("i", { style:"width:0" }));
  const curBox = h("div");
  const fmtT = t => (t / 1000).toFixed(0).padStart(3, " ") + "s";
  const line = e => h("div", { style: e.type === "work" ? "color:#9ff0c6" : e.type === "error" ? "color:#ff9b9b" : e.type === "skip" ? "color:#8a8399" : e.type === "done" ? "color:#ffd479;font-weight:700" : "color:#d9d3e6" },
    h("span", { style:"color:#5d5670" }, fmtT(e.t || 0) + " "), e.msg);
  const showCur = w => {
    if (!w){ curBox.replaceChildren(); return; }
    curBox.replaceChildren(h("div", { class:"card", style:"margin-top:10px;border-color:rgba(61,220,151,.4)" },
      h("div", { class:"tiny" }, "지금 읽은 작품"),
      h("div", { class:"row" }, h("b", { class:"grow" }, w.name), h("span", { class:"tiny" }, "💬 " + fmtNum(w.count) + " · 점수 " + w.score)),
      h("div", { class:"tiny", style:"color:var(--tx2);margin-top:4px" }, w.short),
      h("div", { style:"margin-top:4px" }, w.tags.slice(0, 8).map(t => h("span", { class:"pill", style:"font-size:11px;padding:3px 8px" }, "#" + t))),
      w.introExcerpt ? h("div", { class:"out", style:"margin-top:8px;font-size:12.5px" }, w.introExcerpt) : null));
  };
  const view = {
    push: e => {
      term.append(line(e)); term.scrollTop = term.scrollHeight;
      const L = EXP.live || {};
      if (L.max) prog.firstChild.style.width = Math.min(100, Math.round((L.done ? L.max : Math.max(0, (L.i || 1) - 1)) / L.max * 100)) + "%";
      if (e.type === "work") showCur(e.work);
    },
    status: t => { statusEl.textContent = t; },
    refresh: () => {},
  };
  EXP.feed.forEach(e => term.append(line(e)));
  if (EXP.live && EXP.live.cur) showCur(EXP.live.cur);
  if (!EXP.feed.length) term.append(h("div", { style:"color:#5d5670" }, "탐사봇 대기 중… 아래 '탐사 시작'을 누르면 여기에 실시간으로 떠요."));
  const maxSel = sel([[12,"12개 (1분)"],[24,"24개 (2분)"],[36,"36개 (2~3분)"],[60,"60개 (4분)"]], S.expMax || 36, v => { S.expMax = +v; save(); }, "width:auto");
  const ghIn = h("input", { type:"password", placeholder:"(선택) 깃허브 키 github_pat_… — 넣으면 여기서 바로 시작", value: getKeys().github || "", autocomplete:"off", oninput:e => { const v = e.target.value.trim(); if (!v || /^(github_pat_|ghp_)/.test(v)) setKey("github", v); } });
  box.append(
    h("div", { class:"card" },
      h("div", { class:"muted" }, "탐사봇이 제타 공개 페이지(홈·랭킹·작품 소개)를 천천히 돌면서 작품을 읽고 분석해요. 언리밋(성인 모드)·성인 태그 작품은 건너뛰어요."),
      h("div", { class:"row", style:"margin-top:10px" }, maxSel,
        h("button", { class:"btn p grow", onclick: async e => { e.target.disabled = true; await expStart(S.expMax || 36); setTimeout(() => e.target.disabled = false, 4000); } }, "🛰 지금 탐사 시작")),
      h("details", { style:"margin-top:8px" }, h("summary", { class:"tiny" }, "여기서 바로 시작하려면 (선택)"),
        h("div", { class:"tiny", style:"margin:6px 0" }, "깃허브 → Settings → Developer settings → Fine-grained tokens → Generate → Repository: deca19/zeta, 권한 Actions: Read and write → 만든 키를 붙여넣기. 키가 없으면 버튼이 깃허브 화면을 열어 주고, 거기서 'Run workflow'만 누르면 돼요."),
        ghIn)),
    h("div", { class:"card" }, statusEl, prog, h("div", { style:"height:8px" }), term, curBox,
      h("div", { class:"btns" },
        h("button", { class:"btn sm", onclick:() => expReplay(term, view) }, "⏪ 지난 탐사 다시 보기"),
        h("a", { class:"btn sm", href: EXP_ACTIONS_URL, target:"_blank", rel:"noopener", style:"text-decoration:none" }, "깃허브 로그 보기 ↗")))
  );
  expConnect(view);
}
async function expReplay(term, view){
  const d = await expLoad(true);
  if (!d || !d.log || !d.log.length) return toast("아직 지난 탐사 기록이 없어요");
  clearTimeout(EXP.replayT);
  term.replaceChildren(h("div", { style:"color:#ffd479" }, `⏪ ${new Date(d.updatedAt).toLocaleString("ko-KR")} 탐사를 다시 보여줘요 (5배속)`));
  EXP.live = { max: (d.log[0] && d.log[0].max) || d.works.length, i: 0, cur: null, done: false };
  let k = 0;
  const step = () => {
    if (!term.isConnected || k >= d.log.length) return;
    const e = d.log[k++];
    if (e.type === "visit" && e.i) EXP.live.i = e.i;
    if (e.type === "done") EXP.live.done = true;
    view.push(e);
    const nx = d.log[k]; EXP.replayT = setTimeout(step, nx ? Math.max(60, Math.min(1500, (nx.t - e.t) / 5)) : 0);
  };
  step();
}
async function expResult(box){
  const wait = h("div", { class:"card muted" }, "결과 불러오는 중…"); box.append(wait);
  const d = await expLoad(); wait.remove();
  if (!d){ box.append(h("div", { class:"card" }, h("div", { class:"muted" }, "아직 탐사 결과가 없어요. 🔴 실시간 탐사에서 탐사를 한 번 돌려 주세요."))); return; }
  const ws = [...d.works].sort((a, b) => b.count - a.count);
  const st = d.stats || {};
  let filter = "";
  const list = h("div");
  const drawList = () => {
    list.replaceChildren();
    ws.filter(w => !filter || w.tags.some(t => t.toLowerCase() === filter) ).forEach((w, i) => {
      const more = h("div", { class:"hidden" },
        w.introExcerpt ? h("div", { class:"out", style:"margin-top:8px;font-size:12.5px" }, w.introExcerpt) : null,
        w.longExcerpt ? h("div", { class:"tiny", style:"margin-top:6px" }, "설명: " + w.longExcerpt) : null,
        h("div", { class:"tiny", style:"margin-top:6px" }, `인트로 ${w.f.introLen}자 · 묘사 ${w.f.introNarration}% · 캐릭터 ${w.f.charCount}명 · 예시 대화 ${w.f.exampleConvs}개 · 하루 평균 ${fmtNum(w.f.perDay)}`));
      list.append(h("div", { class:"card" },
        h("div", { class:"row", style:"align-items:flex-start" },
          h("b", { style:"min-width:26px;color:var(--tx3)" }, i + 1),
          h("div", { class:"grow", onclick:() => more.classList.toggle("hidden") },
            h("b", null, w.name), h("div", { class:"tiny" }, (w.creator ? "by " + w.creator + " · " : "") + "💬 " + fmtNum(w.count) + (st.rising && st.rising.includes(w.id) ? " · 🔥 급상승" : "")),
            h("div", { class:"tiny", style:"color:var(--tx2);margin-top:4px" }, w.short),
            h("div", { style:"margin-top:4px" }, w.tags.slice(0, 6).map(t => h("span", { class:"pill", style:"font-size:11px;padding:3px 8px" }, "#" + t)))),
          h("div", { style:"text-align:center" }, h("div", { style:"font-family:'Black Han Sans';font-size:22px" }, w.score), h("div", { class:"tiny", style:"font-size:10px" }, "점수"))),
        more,
        h("div", { class:"btns" },
          h("button", { class:"btn sm", onclick:() => more.classList.toggle("hidden") }, "자세히"),
          h("button", { class:"btn sm v", onclick:() => aiRefWhy(expToRef(w)) }, "🤖 인기 비결"),
          h("button", { class:"btn sm", onclick:() => { const n = expAddRefs([w]); toast(n ? "참고 작품에 넣었어요" : "이미 들어 있어요"); } }, "➕ 참고 작품"),
          h("a", { class:"btn sm", href: w.url, target:"_blank", rel:"noopener", style:"text-decoration:none" }, "제타에서 보기 ↗"))));
    });
  };
  const tagRow = h("div");
  const drawTags = () => tagRow.replaceChildren(h("button", { class:"pill" + (!filter ? " on" : ""), onclick:() => { filter = ""; drawTags(); drawList(); } }, "전체"),
    ...(st.tags || []).slice(0, 14).map(([t, c]) => h("button", { class:"pill" + (filter === t ? " on" : ""), onclick:() => { filter = filter === t ? "" : t; drawTags(); drawList(); } }, "#" + t + " " + c)));
  box.append(
    h("div", { class:"card" },
      h("div", { class:"row" }, h("div", { class:"grow" }, h("b", null, `작품 ${ws.length}개 분석`), h("div", { class:"tiny" }, "마지막 탐사 " + new Date(d.updatedAt).toLocaleString("ko-KR") + " · 언리밋·성인 태그 제외")),
        h("button", { class:"btn sm", onclick:() => { EXP.data = null; S.expTab = "result"; renderApp("explore"); } }, "🔄")),
      h("div", { class:"btns" },
        h("button", { class:"btn v", onclick:() => aiRun("제타 트렌드 분석", [{ role:"system", content:SYS_WRITER }, { role:"user", content: expTrendPrompt(d) }], { maxTokens: 8000 }) }, "🤖 AI 트렌드 분석"),
        h("button", { class:"btn", onclick:() => { const n = expAddRefs(ws.slice(0, 20)); toast(n + "개를 참고 작품에 넣었어요 → 🧬 작품 분석실에서 인기 공식 학습"); } }, "➕ 상위 20개 참고 작품에"))),
    h("div", { class:"card" }, h("h3", null, "🏷 태그로 보기"), tagRow), list);
  drawTags(); drawList();
}
async function expFormula(box){
  const d = await expLoad();
  if (!d){ box.append(h("div", { class:"card muted" }, "아직 탐사 결과가 없어요.")); return; }
  const st = d.stats || {}, me = myFeats(W());
  const strong = (st.feats || []).filter(f => Math.abs(f.c) >= 0.25);
  const card = h("div", { class:"card" }, h("h3", null, "🧠 지금 제타의 인기 공식"),
    h("div", { class:"tiny", style:"margin-bottom:8px" }, `작품 ${st.n}개 · 대화 수와의 순위 상관 · 내 작품 《${W().name}》과 비교`));
  if (!strong.length) card.append(h("div", { class:"muted" }, "이번 탐사에서는 뚜렷한 공통점이 안 보였어요. 더 많이 탐사하면 정확해져요."));
  strong.slice(0, 8).forEach(f => {
    const mine = me[f.k];
    const has = mine != null;
    const good = !has ? null : f.c > 0 ? mine >= f.topAvg * 0.85 : mine <= f.topAvg * 1.15;
    card.append(h("div", { style:"margin-bottom:10px" },
      h("div", { class:"row" }, h("b", { class:"grow", style:"font-size:13.5px" }, (f.c > 0 ? "⬆ " : "⬇ ") + f.label), h("span", { class:"tiny" }, "관련도 " + Math.round(Math.abs(f.c) * 100) + "%")),
      bar(Math.abs(f.c), 1, f.c > 0 ? "var(--ok)" : "var(--warn)"),
      h("div", { class:"tiny", style:"margin-top:3px" }, `인기작 평균 ${f.topAvg} · 나머지 평균 ${f.botAvg}` + (has ? ` · 내 작품 ${mine} ${good ? "✅" : "→ " + (f.c > 0 ? "늘려 보세요" : "줄여 보세요")}` : ""))));
  });
  box.append(card,
    h("div", { class:"card" }, h("h3", null, "📈 인기작에 많은 장르"),
      ...(st.genresTop || []).slice(0, 8).map(([g, c]) => h("div", { style:"margin-bottom:6px" }, h("div", { class:"row" }, h("span", { class:"grow tiny", style:"color:var(--tx)" }, g), h("span", { class:"tiny" }, c + "개")), bar(c, Math.max(1, (st.genresTop[0] || [0, 1])[1])))),
      h("div", { class:"tiny", style:"margin-top:8px" }, "인기작 단골 태그: " + (st.tagsTop || []).slice(0, 12).map(t => "#" + t[0]).join(" "))),
    h("div", { class:"card" }, h("button", { class:"btn v", style:"width:100%", onclick:() => aiRun("인기 공식 → 내 작품", [{ role:"system", content:SYS_WRITER }, { role:"user", content: expTrendPrompt(d) + "\n\n[내 작품 현재 설정]\n" + (plotAll(W()) || "(비어 있음)") }], { maxTokens: 8000 }) }, "🤖 이 공식으로 내 작품 개선안 받기")));
}
