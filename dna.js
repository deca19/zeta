"use strict";
/* =====================================================================
   🧬 작품 분석실 — 제타 작품 DNA 알고리즘
   · 가져오기: 제타에서 복사한 글을 10칸 + 키워드북 + 상태창으로 자동 정리
   · 진단: 히트 공식 점수 (규칙 기반 채점, AI 없이 즉시)
   · 스타일 DNA: 내 작품들의 공통 패턴 통계 + AI 심층 분석 → 모든 AI 작업에 반영
   · 내 공식으로 새 작품: 내 DNA 요소 재조합 + 새 비틀기
   · 문체 참고 검색: 요청과 비슷한 내 작품 구절을 찾아 AI에게 보여줌
   ===================================================================== */

const GENRE_DICT = {
  "TS·성전환": ["TS","성전환","여자가 되","남자가 되","몸이 바뀌","성별","성녀가 되","여자로","남자로"],
  "판타지": ["마법","기사","제국","성녀","마왕","용사","던전","마나","왕국","검술","기사단"],
  "코미디": ["코믹","코미디","개그","황당","어이없","병맛","당황","허둥","웃기"],
  "로맨스": ["사랑","연애","설레","고백","호감","데이트","두근"],
  "현대·일상": ["학교","회사","편의점","아파트","스마트폰","서울","일상","카페"],
  "이세계·환생": ["이세계","전생","환생","빙의","소환","회귀"],
  "액션·전투": ["전투","전쟁","싸움","전장","총","칼","최전선","마수"],
  "긴장·추격": ["비밀","정체","추적","사냥","도망","쫓","현상금","들키"],
  "신·여신": ["여신","신님","천계","신의","천사","신성"],
  "용병·모험": ["용병","의뢰","길드","모험","파티","현상금"],
  "시스템·앱": ["앱","시스템","상태창","레벨","퀘스트","스킬","알림"],
};
const CONFLICT_WORDS = ["비밀","위기","계약","저주","전쟁","오류","실수","정체","추격","사냥","배신","거짓","금지","들키","숨기","위험","목숨","죽어","죽음","빚","약점","라이벌","원수","오해"];
const HOOK_MARKS = ["갑자기","하필","그런데","알고 보니","눈을 떠","되어버","되었다","?!","…","!","?"];
const JOSA = ["에게서","으로는","에서는","이라도","까지는","에게","에서","으로","부터","까지","처럼","보다","한테","이랑","라고","이다","은","는","이","가","을","를","의","에","로","와","과","도","만","께","요","다","랑","야","아"];
const STOP = new Set(["그","이","저","것","수","등","때","더","좀","잘","또","그리고","하지만","그런","이런","저런","있다","없다","하다","된다","한다","있는","없는","하는","같은","정말","너무","지금","다시","그냥","user","char","항목","내용"]);

function workText(w){ return PLOT_FIELDS.map(f => w.fields[f.k] || "").join("\n") + "\n" + w.lore.map(x => x.k + " " + x.v).join("\n"); }
function hasContent(w){ return workText(w).replace(/\s/g, "").length > (w.ref ? 8 : 40); }
function tokenize(t){
  const out = [];
  for (let raw of (t || "").replace(/\{\{(user|char)\}\}/g, " ").split(/[^가-힣A-Za-z0-9]+/)){
    if (!raw) continue;
    for (const j of JOSA){ if (raw.length > j.length + 1 && raw.endsWith(j)){ raw = raw.slice(0, -j.length); break; } }
    if (raw.length < 2 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    out.push(raw);
  }
  return out;
}
function countIn(t, words){ let n = 0; for (const w of words){ let i = 0; while ((i = t.indexOf(w, i)) >= 0){ n++; i += w.length; } } return n; }

/* ---------- 작품 하나 통계 ---------- */
function statsOf(w){
  const F = k => (w.fields[k] || "").trim();
  const all = workText(w), plain = all.replace(/\s/g, "");
  const quotes = (all.match(/"[^"\n]{1,200}"/g) || []).join("").length;
  const narr = (all.match(/\*[^*\n]{1,300}\*/g) || []).join("").length;
  const sents = all.split(/[.!?…\n]+/).map(s => s.trim()).filter(s => s.length > 1);
  const genres = {};
  for (const g in GENRE_DICT){ const c = countIn(all, GENRE_DICT[g]); if (c) genres[g] = c; }
  const freq = {};
  for (const tk of tokenize(all)) freq[tk] = (freq[tk] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return {
    total: plain.length,
    fieldLen: Object.fromEntries(PLOT_FIELDS.map(f => [f.k, len(F(f.k))])),
    dialogue: all.length ? quotes / all.length : 0,
    narration: all.length ? narr / all.length : 0,
    avgSent: sents.length ? Math.round(sents.reduce((s, x) => s + x.length, 0) / sents.length) : 0,
    ellipsis: plain.length ? Math.round(countIn(all, ["…","..."]) / plain.length * 1000 * 10) / 10 : 0,
    excl: plain.length ? Math.round(countIn(all, ["!","?!"]) / plain.length * 1000 * 10) / 10 : 0,
    userMent: countIn(all, ["{{user}}"]),
    conflict: countIn(all, CONFLICT_WORDS),
    genres, top, freq
  };
}

/* ---------- 히트 공식 점수 (규칙 기반) ---------- */
function scoreOf(w){
  const F = k => (w.fields[k] || "").trim(), st = statsOf(w), items = [];
  const add = (label, max, got, tip, vis) => items.push({ label, max, got: Math.max(0, Math.min(max, Math.round(got))), tip, vis: !!vis });
  // 1. 한 줄 소개 훅
  { const s = F("intro"); let g = 0;
    if (s){ g += 4; const n = len(s); g += n <= 70 ? 4 : n <= 120 ? 2 : 0; g += countIn(s, HOOK_MARKS) ? 3 : 0; g += countIn(s, CONFLICT_WORDS) || /되어|되었|버렸/.test(s) ? 4 : 0; }
    add("한 줄 소개 훅", 15, g, !s ? "한 줄 소개가 비어 있어요." : len(s) > 70 ? "70자 안쪽으로 줄이면 목록에서 더 눈에 띄어요." : !countIn(s, CONFLICT_WORDS) ? "반전이나 사건(되어버렸다, 들켰다, 오류 등)을 한 단어 넣어 보세요." : "좋아요. 물음표나 말줄임으로 궁금증을 더 줄 수 있어요.", true); }
  // 2. 시작 메시지
  { const s = F("first"); let g = 0, tip = "";
    if (!s){ tip = "시작 메시지가 비어 있어요. 첫인상의 80%예요."; }
    else {
      const n = len(s); g += n >= 300 && n <= 1000 ? 6 : n >= 150 ? 3 : 1;
      const hasN = /\*[^*]+\*/.test(s), hasD = /"[^"]+"/.test(s); g += (hasN ? 4 : 0) + (hasD ? 4 : 0);
      const tail = s.slice(-80); g += /[?…]|\{\{user\}\}|당신|너/.test(tail) ? 6 : 2;
      tip = n < 300 ? "300자 이상으로 장면을 더 깔아 주세요." : !hasN || !hasD ? "*묘사*와 \"대사\"를 둘 다 섞어 주세요." : !/[?…]|\{\{user\}\}/.test(tail) ? "마지막을 {{user}}에게 말을 걸거나 행동을 유도하며 끝내 보세요." : "좋아요.";
    }
    add("시작 메시지", 20, g, tip, true); }
  // 3. 캐릭터 선명도
  { let g = 0; ["look","personality","speech"].forEach(k => { const n = len(F(k)); g += n >= 80 ? 3 : n > 0 ? 1.5 : 0; });
    const qs = (F("speech").match(/"[^"]+"/g) || []).length; g += Math.min(6, qs * 2);
    add("캐릭터 선명도", 15, g, qs < 3 ? "말투 칸에 실제 대사 예시를 따옴표로 3개 이상 넣으면 AI가 말투를 훨씬 잘 따라해요." : len(F("look")) < 80 ? "외모를 머리·눈·복장·특징까지 구체적으로." : "좋아요."); }
  // 4. 유저 역할
  { let g = 0; if (F("relation")) g += 5; g += Math.min(5, st.userMent);
    add("유저 역할·관계", 10, g, !F("relation") ? "{{user}}가 누구인지(관계, 입장)를 적어 주세요." : st.userMent < 3 ? "설정 곳곳에 {{user}}를 언급해서 역할을 분명히 해 주세요." : "좋아요."); }
  // 5. 갈등·목표
  add("갈등·목표", 10, Math.min(10, st.conflict * 2.5), st.conflict < 2 ? "비밀·계약·위기·라이벌 같은 갈등 요소가 있으면 대화가 오래 가요." : "좋아요.", true);
  // 6. 세계관
  { const n = len(F("world")) + len(F("situation")); add("세계관·상황", 10, n >= 300 ? 10 : n >= 120 ? 6 : n > 0 ? 3 : 0, n < 120 ? "세계관과 시작 상황을 조금 더 채워 주세요." : "좋아요."); }
  // 7. 예시 대화
  { const s = F("example"), turns = (s.match(/\{\{char\}\}\s*[:：]/g) || []).length;
    add("예시 대화", 10, turns >= 3 ? 10 : turns * 3 + (s ? 1 : 0), turns < 3 ? "예시 대화를 3번 이상 주고받게 써 주세요." : "좋아요."); }
  // 8. 키워드북·장치
  { const on = w.lore.filter(x => x.on && x.v.trim()).length; let g = Math.min(7, on * 1.2) + (w.status.items.length ? 3 : 0);
    add("키워드북·재미 장치", 10, g, on < 4 ? "고유 설정(인물·장소·조직)을 키워드북에 4개 이상 넣어 주세요." : !w.status.items.length ? "상태창 같은 재미 장치를 하나 넣어 보세요." : "좋아요."); }
  const full = items.reduce((s, x) => s + x.got, 0);
  const vi = items.filter(x => x.vis), visTotal = Math.round(vi.reduce((s, x) => s + x.got, 0) / vi.reduce((s, x) => s + x.max, 0) * 100);
  const total = w.ref ? visTotal : full;
  const gradeOf = t => t >= 90 ? "S" : t >= 78 ? "A" : t >= 62 ? "B" : t >= 45 ? "C" : "D";
  return { total, grade: gradeOf(total), items, st, visTotal, visGrade: gradeOf(visTotal), full };
}

/* ---------- 여러 작품 통합 DNA (통계) ---------- */
function dnaStats(){
  const ws = S.order.map(id => S.works[id]).filter(hasContent);
  const genres = {}, wordWorks = {}, sum = { dialogue:0, narration:0, avgSent:0, ellipsis:0, excl:0, total:0 };
  for (const w of ws){
    const st = statsOf(w);
    for (const g in st.genres) genres[g] = (genres[g] || 0) + 1;
    for (const k in sum) sum[k] += st[k];
    for (const t in st.freq) (wordWorks[t] = wordWorks[t] || new Set()).add(w.id);
  }
  const n = ws.length || 1;
  for (const k in sum) sum[k] = sum[k] / n;
  const common = Object.entries(wordWorks).filter(([, s]) => s.size >= Math.min(2, ws.length)).map(([t, s]) => [t, s.size]).sort((a, b) => b[1] - a[1]).slice(0, 20);
  return { ws, genres: Object.entries(genres).sort((a, b) => b[1] - a[1]), avg: sum, common };
}
function dnaLocalText(){
  const d = dnaStats(); if (!d.ws.length) return "";
  return `[통계로 본 작가 패턴 — 작품 ${d.ws.length}개]
- 자주 쓰는 장르: ${d.genres.map(([g, c]) => g + "(" + c + ")").join(", ") || "-"}
- 여러 작품에 반복되는 요소: ${d.common.map(x => x[0]).slice(0, 12).join(", ") || "-"}
- 대사 비중 ${Math.round(d.avg.dialogue*100)}%, 묘사(*…*) 비중 ${Math.round(d.avg.narration*100)}%, 평균 문장 ${Math.round(d.avg.avgSent)}자
- 1000자당 말줄임 ${d.avg.ellipsis.toFixed(1)}회, 느낌표 ${d.avg.excl.toFixed(1)}회`;
}

/* ---------- 문체 참고 검색 (2글자 조각 유사도) ---------- */
function bigrams(t){ const s = (t || "").replace(/\s+/g, ""), set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; }
function simil(a, b){ if (!a.size || !b.size) return 0; let n = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const g of x) if (y.has(g)) n++; return n / (a.size + b.size - n); }
function styleSnippets(query, excludeId){
  const q = bigrams(query);
  return S.order.map(id => S.works[id]).filter(w => w.id !== excludeId && hasContent(w))
    .map(w => ({ w, s: simil(q, bigrams(workText(w))) })).sort((a, b) => b.s - a.s).slice(0, 2)
    .map(({ w }) => { const ex = (w.fields.first || w.fields.speech || w.fields.intro || "").trim().slice(0, 420); return ex ? `《${w.name}》 중에서:\n${ex}` : ""; }).filter(Boolean);
}
function styleContext(query){
  const D = S.dna || {}; if (!D.use) return "";
  const parts = [];
  if ((D.profile || "").trim()) parts.push("[이 작가의 스타일 프로필 — 이 작가가 쓴 것처럼 써라]\n" + D.profile.trim());
  const loc = dnaLocalText(); if (loc) parts.push(loc);
  const sn = styleSnippets(query, S.cur); if (sn.length) parts.push("[작가의 실제 문체 참고 — 베끼지 말고 리듬·말맛만 참고]\n" + sn.join("\n\n"));
  try { const pt = popularityText(learnPopularity()); if (pt) parts.push(pt + "\n(참고용 통계일 뿐, 작가 스타일이 우선)"); } catch(e){}
  return parts.join("\n\n");
}

/* ---------- 가져오기 ---------- */
function heuristicImport(text){
  const fields = {}; const sec = parseSections(text);
  for (const f of PLOT_FIELDS){ const v = sec[f.t.replace(/\s/g, "")]; if (v) fields[f.k] = v; }
  if (Object.keys(fields).length) return fields;
  const MAP = [["name",/^(이름|캐릭터 ?이름|제목)\s*[:：]/],["intro",/^(소개|한 ?줄 ?소개|설명)\s*[:：]/],["world",/^(세계관|배경)\s*[:：]/],["look",/^(외모|외형)\s*[:：]/],["personality",/^(성격)\s*[:：]/],["speech",/^(말투|어투)\s*[:：]/],["relation",/^(관계|유저와의 ?관계)\s*[:：]/],["situation",/^(상황|시작 ?상황)\s*[:：]/],["first",/^(시작 ?메시지|첫 ?메시지|인트로|첫 ?대사)\s*[:：]/],["example",/^(예시 ?대화|대화 ?예시)\s*[:：]/]];
  let cur = null;
  for (const line of text.split("\n")){
    const m = MAP.find(([, re]) => re.test(line.trim()));
    if (m){ cur = m[0]; fields[cur] = line.trim().replace(m[1], "").trim(); }
    else if (cur) fields[cur] += "\n" + line;
  }
  for (const k in fields) fields[k] = fields[k].trim();
  if (!Object.keys(fields).length) fields.world = text.trim();
  return fields;
}
function importPrompt(text, isRef){
  return `아래는 AI 캐릭터 채팅 플랫폼 '제타'의 작품을 복사해 온 글이야 (정리 안 됨). 내용을 바꾸거나 지어내지 말고, 원문 표현을 최대한 그대로 살려서 아래 형식으로 나눠 담아줘. 없는 항목은 '(없음)'.
${PLOT_FIELDS.map(f => "【" + f.t + "】").join("\n")}${isRef ? "\n【제작자】\n【대화 수】\n숫자만 (예: 12000, 1.2만이면 12000)\n【좋아요 수】\n숫자만" : ""}
【키워드북】
[키워드, 별칭]
내용
(빈 줄로 구분)
【상태창】
항목: 예시값 (한 줄에 하나)

캐릭터 이름과 유저를 가리키는 말은 {{char}}, {{user}}로 바꾸지 말고 원문 그대로 둬. 다른 말은 쓰지 마.

[복사한 글]
${text}`;
}
function applyImport(w, out, overwrite){
  const sec = parseSections(out); let n = 0;
  for (const f of PLOT_FIELDS){
    const v = sec[f.t.replace(/\s/g, "")]; if (!v || /^\(?없음\)?$/.test(v)) continue;
    if (!overwrite && (w.fields[f.k] || "").trim()) continue;
    w.fields[f.k] = v; n++;
  }
  const lore = sec["키워드북"];
  if (lore && !/^\(?없음\)?$/.test(lore)) lore.split(/\n(?=\s*\[)/).forEach(b => { const m = b.match(/^\s*\[([^\]]+)\]\s*\n?([\s\S]*)$/); if (m && m[2].trim() && !w.lore.some(x => x.k === m[1].trim())){ w.lore.push({ id:uid(), k:m[1].trim(), v:m[2].trim(), on:true }); n++; } });
  const stt = sec["상태창"];
  if (stt && !/^\(?없음\)?$/.test(stt) && (overwrite || !w.status.items.length)){
    const items = stt.split("\n").map(l => l.replace(/^[-•*\s]+/, "").trim()).filter(l => l.includes(":")).map(l => { const i = l.indexOf(":"); return { l: l.slice(0, i).trim(), e: l.slice(i + 1).trim() }; });
    if (items.length){ w.status.items = items; n++; }
  }
  if (w.ref){
    const a = sec["제작자"]; if (a && !/없음/.test(a)) w.author = a.split("\n")[0].trim().slice(0, 40);
    const c = parseKNum(sec["대화수"]), l = parseKNum(sec["좋아요수"]);
    w.pop = w.pop || {}; if (c) w.pop.chats = c; if (l) w.pop.likes = l;
  }
  save(); return n;
}
function parseKNum(t){
  if (!t) return 0;
  const m = String(t).replace(/,/g, "").match(/([\d.]+)\s*(만|천|k|K|m|M)?/); if (!m) return 0;
  let v = parseFloat(m[1]); const u = m[2];
  if (u === "만") v *= 10000; else if (u === "천" || u === "k" || u === "K") v *= 1000; else if (u === "m" || u === "M") v *= 1e6;
  return Math.round(v) || 0;
}

/* ---------- 화면 ---------- */
const DNA_TABS = [["import","📥 가져오기"],["check","🩺 진단"],["refs","👥 다른 작품"],["dna","🧬 내 스타일 DNA"],["new","💡 내 공식 새 작품"]];
function bar(v, max, color){ return h("div", { class:"prog", style:"margin-top:3px" }, h("i", { style:`width:${Math.round(v/max*100)}%;${color ? "background:" + color : ""}` })); }
VIEWS.dna = (body) => {
  S.dna = S.dna || { use:false, profile:"" };
  S.refs = S.refs || [];
  const tabs = h("div", { class:"tabs" }), box = h("div");
  const drawTabs = () => tabs.replaceChildren(...DNA_TABS.map(([k, t]) => h("button", { class:"pill" + ((S.dnaTab || "check") === k ? " on" : ""), onclick:() => { S.dnaTab = k; save(); drawTabs(); draw(); } }, t)));
  function draw(){
    box.replaceChildren();
    const tab = S.dnaTab || "check";
    if (tab === "import") return tabImport(box);
    if (tab === "check") return tabCheck(box);
    if (tab === "dna") return tabDna(box);
    if (tab === "refs") return tabRefs(box);
    return tabNew(box);
  }
  body.append(tabs, box); drawTabs(); draw();
};
function tabImport(box){
  const ta = h("textarea", { style:"min-height:220px", placeholder:"제타 작품 편집 화면에서 소개·프롬프트(설정)·시작 메시지·예시 대화·키워드북을 전부 복사해서 그대로 붙여넣으세요. 순서·형식 상관없어요.\n\n여러 작품을 한 번에 넣으려면 작품 사이에 === 한 줄을 넣으세요." });
  const target = h("select", null,
    h("option", { value:"new" }, "내 새 작품으로 만들기"),
    h("option", { value:"fill" }, "지금 작품(" + W().name + ")의 빈칸만 채우기"),
    h("option", { value:"over" }, "지금 작품(" + W().name + ")에 덮어쓰기"),
    h("option", { value:"ref" }, "👥 다른 사람 작품 (참고·분석용)"));
  if (S.importTarget) target.value = S.importTarget;
  target.onchange = () => { S.importTarget = target.value; save(); };
  const status = h("div", { class:"tiny", style:"margin-top:8px" });
  const go = async () => {
    const blocks = ta.value.split(/\n\s*={3,}\s*\n/).map(s => s.trim()).filter(Boolean);
    if (!blocks.length) return toast("붙여넣은 글이 없어요");
    const tv = target.value, isRef = tv === "ref";
    if ((tv === "fill" || tv === "over") && blocks.length > 1) return toast("지금 작품에 넣을 땐 한 작품만 붙여넣어 주세요");
    goBtn.disabled = true;
    let made = 0, failed = 0;
    for (let i = 0; i < blocks.length; i++){
      const text = blocks[i];
      let w;
      if (tv === "fill" || tv === "over") w = W();
      else if (isRef){ w = blankWork("참고 작품 " + ((S.refs || []).length + 1), { ref:true, author:"", pop:{} }); S.refs.unshift(w); }
      else { w = blankWork("가져온 작품 " + (i + 1)); S.works[w.id] = w; S.order.unshift(w.id); }
      const overwrite = tv !== "fill";
      status.textContent = `정리 중… ${i + 1}/${blocks.length}`;
      let done = false;
      if (aiOn()){
        try {
          const out = await aiChat([{ role:"system", content:"너는 글을 정확히 분류하는 편집자다. 원문을 바꾸지 않는다." }, { role:"user", content: importPrompt(text, isRef) }], { maxTokens: 12000, temperature: 0.2 });
          done = applyImport(w, out, overwrite) > 0;
        } catch(e){ failed++; status.textContent = "AI 정리 실패 → 기본 정리로 넣었어요: " + e.message.slice(0, 80); }
      }
      if (!done){
        const hf = heuristicImport(text);
        for (const k in hf) if (overwrite || !(w.fields[k] || "").trim()) w.fields[k] = hf[k];
        if (isRef){ const c = text.match(/(대화|채팅)\s*(수)?\s*[:：]?\s*([\d.,]+\s*(만|천|k|K)?)/), l = text.match(/(좋아요|하트)\s*[:：]?\s*([\d.,]+\s*(만|천|k|K)?)/); if (c) w.pop.chats = parseKNum(c[3]); if (l) w.pop.likes = parseKNum(l[2]); }
      }
      if ((w.fields.name || "").trim() && /^(가져온|참고) 작품/.test(w.name)) w.name = w.fields.name.trim().slice(0, 40);
      w.imported = text.slice(0, 6000);
      made++;
    }
    if (tv === "new") S.cur = S.order[0];
    save(); goBtn.disabled = false;
    if (!failed) status.textContent = "";
    toast(made + "개 작품을 정리했어요");
    S.dnaTab = isRef ? "refs" : "check"; renderApp("dna");
  };
  const goBtn = h("button", { class:"btn p", style:"width:100%;margin-top:10px;padding:12px", onclick: go }, "🪄 정리해서 넣기");
  const capBtn = filePick("📸 캡처 사진으로 가져오기", "image/*", true, async files => {
    status.textContent = "캡처 읽는 중… (구글 Gemini)";
    try {
      const t = await visionRead(files, "이 스크린샷들은 AI 캐릭터 채팅 앱 '제타'의 화면이야. 화면에 보이는 글자를 위에서 아래로, 사진 순서대로 빠짐없이 원문 그대로 옮겨 적어. 캐릭터 이름, 제작자 닉네임, 소개, 태그, 대화 수·좋아요 같은 숫자, 시작 메시지, 설명 전부. 해석·요약·추가 금지. 버튼 이름, 광고, 상태바 시간은 빼.");
      ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + t.trim();
      status.textContent = "✅ 읽었어요. 내용을 확인하고 '정리해서 넣기'를 눌러 주세요.";
    } catch(e){ status.textContent = "⚠ " + e.message; }
  }, "");
  box.append(
    h("div", { class:"card" },
      h("div", { class:"muted" }, aiOn() ? "🤖 AI가 원문을 그대로 살려서 10칸 + 키워드북 + 상태창으로 나눠 넣어요." : "AI가 꺼져 있으면 '이름:', '성격:' 같은 머리말 기준으로 나눠요. AI를 켜면 훨씬 정확해요."),
      ta, h("div", { class:"btns" }, capBtn), h("label", { class:"f" }, "넣을 곳"), target,
      goBtn, status),
    h("div", { class:"card" }, h("h3", null, "💡 팁"), h("div", { class:"muted" },
      "• 내 작품: 제타 → 내 캐릭터 → 수정 화면에서 각 칸을 길게 눌러 전체 선택 → 복사 → 여기에 차례로 붙여넣기.", h("br"),
      "• 다른 사람 작품: 캐릭터 소개 화면을 캡처해서 📸로 넣거나, 보이는 글(소개·시작 메시지·대화 수)을 복사해 붙여넣고 '👥 다른 사람 작품'을 고르세요. 숨겨진 설정은 못 보니 보이는 부분만으로 분석해요."))
  );
}
function tabCheck(box){
  const w = W(), sc = scoreOf(w), st = sc.st;
  const col = sc.total >= 78 ? "var(--ok)" : sc.total >= 62 ? "var(--warn)" : "var(--bad)";
  const weak = sc.items.filter(x => x.got < x.max * .7);
  box.append(
    h("div", { class:"card", style:"text-align:center" },
      h("div", { class:"tiny" }, "✦ " + w.name),
      h("div", { style:`font-family:'Black Han Sans';font-size:64px;line-height:1.1;color:${col}` }, sc.grade),
      h("div", { style:"font-weight:700;font-size:18px" }, sc.total + " / 100"),
      h("div", { class:"tiny" }, "히트 공식 점수 — 제타에서 오래 대화가 이어지는 작품의 조건으로 채점")),
    h("div", { class:"card" }, sc.items.map(x => h("div", { style:"margin-bottom:10px" },
      h("div", { class:"row" }, h("b", { class:"grow", style:"font-size:13.5px" }, x.label), h("span", { class:"tiny" }, x.got + "/" + x.max)),
      bar(x.got, x.max, x.got >= x.max * .7 ? "var(--ok)" : x.got >= x.max * .4 ? "var(--warn)" : "var(--bad)"),
      x.tip !== "좋아요." ? h("div", { class:"tiny", style:"margin-top:3px" }, "→ " + x.tip) : null)),
      weak.length ? h("button", { class:"btn v", style:"width:100%;margin-top:4px", onclick:() => fixWeak(w, weak) }, "🤖 약한 부분만 AI로 고치기 (" + weak.length + "곳)") : h("div", { class:"okc", style:"text-align:center" }, "✨ 약한 곳이 없어요!")),
    h("div", { class:"card" }, h("h3", null, "📊 글 성격"),
      h("div", { class:"stat" },
        ...[[st.total, "총 글자 (공백 제외)"], [Math.round(st.dialogue*100) + "%", "대사 비중"], [Math.round(st.narration*100) + "%", "묘사(*…*) 비중"], [st.avgSent + "자", "평균 문장 길이"], [st.conflict, "갈등 단어"], [st.userMent, "{{user}} 언급"]].map(([n, l]) => h("div", null, h("b", null, n), h("span", null, l)))),
      h("div", { style:"margin-top:10px" }, Object.entries(st.genres).sort((a, b) => b[1] - a[1]).map(([g, c]) => h("span", { class:"pill" }, g + " " + c))),
      h("div", { style:"margin-top:6px" }, st.top.slice(0, 10).map(([t, c]) => h("span", { class:"pill", style:"opacity:.8" }, t + " ×" + c)))),
    h("div", { class:"card" }, h("h3", null, "🏆 내 작품 순위"),
      ...S.order.map(id => S.works[id]).filter(hasContent).map(x => ({ x, s: scoreOf(x) })).sort((a, b) => b.s.total - a.s.total).map(({ x, s }) =>
        h("div", { style:"margin-top:8px", onclick:() => { S.cur = x.id; save(); renderApp("dna"); } }, h("div", { class:"row" }, h("span", { class:"grow" }, (x.id === S.cur ? "✦ " : "") + x.name), h("b", null, s.grade + " · " + s.total)), bar(s.total, 100))),
      S.order.map(id => S.works[id]).filter(hasContent).length ? null : h("div", { class:"muted" }, "내용이 있는 작품이 없어요. 📥 가져오기로 제타 작품을 붙여넣어 보세요."))
  );
}
function fixWeak(w, weak){
  const prompt = `아래 제타 캐릭터 설정의 약한 부분을 고쳐줘. 고쳐야 할 점:
${weak.map(x => "- " + x.label + ": " + x.tip).join("\n")}

고친 항목만, 정확히 이 형식으로 출력해 (고치지 않는 항목은 쓰지 마):
【항목 제목】
고친 전체 내용

항목 제목은 다음 중에서만: ${PLOT_FIELDS.map(f => f.t).join(", ")}
기존 설정과 모순되지 않게, 원래 분위기와 말투를 살려서.

[현재 설정]
${plotAll(w) || "(비어 있음)"}`;
  aiRun("약점 고치기", [{ role:"system", content:SYS_WRITER }, { role:"user", content:prompt }], {
    maxTokens: 8000, applyLabel:"✔ 고친 항목 적용",
    onApply: t => { const n = applyWhole(w, t, true, () => renderApp("dna")); return n; }
  });
}
function tabDna(box){
  const d = dnaStats(), D = S.dna;
  const prof = h("div", { class:"out", style:"min-height:60px" }, (D.profile || "").trim() || "아직 없어요. 아래 버튼으로 AI 심층 분석을 돌려 보세요.");
  const maxG = Math.max(1, ...d.genres.map(x => x[1]));
  box.append(
    h("div", { class:"card" }, h("h3", null, "🧬 통계로 본 내 패턴"),
      d.ws.length ? h("div", null,
        h("div", { class:"tiny" }, `분석한 작품 ${d.ws.length}개: ` + d.ws.map(x => x.name).join(", ")),
        h("label", { class:"f" }, "장르 분포"),
        ...d.genres.map(([g, c]) => h("div", { style:"margin-bottom:6px" }, h("div", { class:"row" }, h("span", { class:"grow tiny", style:"color:var(--tx)" }, g), h("span", { class:"tiny" }, c + "개 작품")), bar(c, maxG))),
        h("label", { class:"f" }, "여러 작품에 반복되는 요소 (내 시그니처)"),
        h("div", null, d.common.map(([t, c]) => h("span", { class:"pill" }, t))),
        h("div", { class:"stat", style:"margin-top:10px" },
          h("div", null, h("b", null, Math.round(d.avg.dialogue*100) + "%"), h("span", null, "평균 대사 비중")),
          h("div", null, h("b", null, Math.round(d.avg.avgSent) + "자"), h("span", null, "평균 문장 길이")))
      ) : h("div", { class:"muted" }, "내용이 있는 작품이 없어요. 📥 가져오기부터 해 주세요.")),
    h("div", { class:"card" }, h("h3", null, "🤖 AI 심층 분석 — 작가 스타일 프로필"), prof,
      h("div", { class:"btns" },
        h("button", { class:"btn v", onclick:() => {
          if (!d.ws.length) return toast("분석할 작품이 없어요");
          const corpus = d.ws.map(x => `■ 작품 《${x.name}》\n` + plotAll(x).slice(0, 3500)).join("\n\n").slice(0, 24000);
          aiRun("작가 스타일 분석", [{ role:"system", content:SYS_WRITER }, { role:"user", content:
`아래는 한 작가가 제타(AI 캐릭터 채팅)에 만든 작품들이야. 이 작가만의 '공식'을 분석해서, 다른 AI가 이 작가처럼 쓰는 데 바로 쓸 수 있는 스타일 프로필을 만들어줘.
형식 (불릿, 구체적인 예시 포함, 700~1100자):
■ 장르·소재 취향
■ 주인공 공식 (어떤 인물을 어떤 상황에 던지는지)
■ 웃음·긴장 공식 (반복되는 개그 패턴, 반전 장치)
■ 문체 (문장 길이, 묘사 방식, 대사 말맛, 자주 쓰는 표현)
■ 유저 위치 (유저를 어떤 역할로 두는지)
■ 강점 3가지
■ 보완하면 좋은 점 3가지
■ 이 작가에게 맞는 다음 작품 방향 3가지

${dnaLocalText()}

${corpus}` }], { maxTokens: 6000, applyLabel:"✔ 내 스타일 프로필로 저장", onApply: t => { D.profile = t; D.use = true; save(); toast("스타일 프로필 저장 · 반영 켜짐"); renderApp("dna"); return true; } });
        } }, "🧬 AI로 스타일 분석"),
        D.profile ? h("button", { class:"btn", onclick:() => askLong("스타일 프로필 고치기", D.profile, v => { D.profile = v; save(); renderApp("dna"); }) }, "✏️ 고치기") : null),
      h("label", { class:"check", style:"border:0;margin-top:6px" }, h("input", { type:"checkbox", checked:!!D.use, onchange:e => { D.use = e.target.checked; save(); toast(D.use ? "모든 AI 작업에 내 스타일 반영" : "스타일 반영 끔"); } }),
        h("div", null, "✍️ 모든 AI 작업에 내 스타일 반영 ", h("span", { class:"tiny" }, "(프로필 + 통계 + 비슷한 내 작품 구절을 AI에게 함께 보여줘요)"))))
  );
}
function tabNew(box){
  const d = dnaStats();
  const P = rnd(Date.now() % 100000);
  const pick = a => a[Math.floor(P() * a.length)];
  const myGenres = d.genres.map(x => x[0]), mySig = d.common.map(x => x[0]);
  const ideas = Array.from({ length: 3 }, () => {
    const g1 = myGenres.length ? pick(myGenres.slice(0, 3)) : pick(Object.keys(GENRE_DICT));
    const g2 = pick(Object.keys(GENRE_DICT).filter(x => x !== g1));
    const hero = pick(IDEA["주인공"]), ev = pick(IDEA["사건"]), tw = pick(IDEA["반전"]), mood = pick(IDEA["분위기"]);
    const sig = mySig.length ? pick(mySig.slice(0, 8)) : "";
    return { g1, g2, hero, ev, tw, mood, sig };
  });
  box.append(h("div", { class:"card" }, h("div", { class:"muted" }, d.ws.length ? "내 작품에서 자주 쓰는 장르와 시그니처 요소에, 처음 써 보는 장르 하나를 섞어 새 공식을 만들어요." : "작품이 아직 없어서 무작위로 섞었어요. 📥 가져오기 후에 쓰면 내 취향을 반영해요."),
    h("div", { class:"btns" }, h("button", { class:"btn", onclick:() => renderApp("dna") }, "🎲 다시 섞기"))));
  ideas.forEach((x, i) => {
    const text = `장르: ${x.g1} × ${x.g2} (분위기: ${x.mood})\n주인공: ${x.hero}\n사건: ${x.ev}\n반전: ${x.tw}${x.sig ? "\n내 시그니처 요소: " + x.sig : ""}`;
    box.append(h("div", { class:"card" }, h("h3", null, "💡 공식 " + (i + 1)), h("div", { class:"out" }, text),
      h("div", { class:"btns" },
        h("button", { class:"btn v", onclick:() => aiIdea(text + "\n\n(이 작가의 기존 작품 공식을 살리되, 새로 섞인 장르로 신선하게)") }, "🤖 AI 기획"),
        h("button", { class:"btn p", onclick:() => {
          const w = blankWork(x.hero, { fields:{ intro:`${x.hero} — ${x.ev}` } }); S.works[w.id] = w; S.order.unshift(w.id); S.cur = w.id; save();
          location.hash = "plot"; setTimeout(() => { if (aiOn()) aiWhole(W(), () => renderApp("plot")); }, 300);
        } }, "➕ 새 작품 + 🪄 통째로"))));
  });
}

/* =====================================================================
   👥 다른 사람 작품 — 참고 서재 + 인기 공식 학습
   ===================================================================== */
const FEAT = [
  ["introLen","한 줄 소개 길이", w => len(w.fields.intro || ""), "자"],
  ["firstLen","시작 메시지 길이", w => len(w.fields.first || ""), "자"],
  ["dialogue","대사 비중", (w, st) => Math.round(st.dialogue * 100), "%"],
  ["narration","묘사(*…*) 비중", (w, st) => Math.round(st.narration * 100), "%"],
  ["conflict","갈등·비밀 요소", (w, st) => st.conflict, "개"],
  ["userMent","유저 언급", (w, st) => st.userMent, "회"],
  ["avgSent","평균 문장 길이", (w, st) => st.avgSent, "자"],
  ["excl","느낌표 빈도", (w, st) => st.excl, "/천자"],
  ["ellipsis","말줄임 빈도", (w, st) => st.ellipsis, "/천자"],
  ["hook","소개 훅 점수", (w, st, sc) => sc.items[0].got, "/15"],
  ["opening","시작 메시지 점수", (w, st, sc) => sc.items[1].got, "/20"],
];
function popOf(r){ const p = r.pop || {}; return Math.log10(1 + (+p.chats || 0)) + 0.5 * Math.log10(1 + (+p.likes || 0)); }
function fmtNum(n){ n = +n || 0; return n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "만" : n >= 1000 ? (n / 1000).toFixed(1) + "천" : String(n); }
function ranks(a){ const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let k = 0; while (k < idx.length){ let j = k; while (j + 1 < idx.length && idx[j + 1][0] === idx[k][0]) j++; for (let t = k; t <= j; t++) r[idx[t][1]] = (k + j) / 2; k = j + 1; } return r; }
function corr(x, y){ const n = x.length; if (n < 3) return 0; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let c = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++){ c += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx && sy ? c / Math.sqrt(sx * sy) : 0; }
function featsOf(w){ const st = statsOf(w), sc = scoreOf(w); return { st, sc, f: Object.fromEntries(FEAT.map(([k, , fn]) => [k, fn(w, st, sc)])) }; }
function learnPopularity(){
  const rows = (S.refs || []).filter(r => popOf(r) > 0 && hasContent(r)).map(r => Object.assign({ r, p: popOf(r) }, featsOf(r)));
  if (rows.length < 3) return null;
  const pr = ranks(rows.map(x => x.p)), sorted = [...rows].sort((a, b) => b.p - a.p), half = Math.ceil(rows.length / 2), top = sorted.slice(0, half), bot = sorted.slice(half);
  const feats = FEAT.map(([k, label, , unit]) => {
    const c = corr(ranks(rows.map(x => x.f[k])), pr);
    const avg = a => a.length ? a.reduce((s, x) => s + x.f[k], 0) / a.length : 0;
    return { k, label, unit, c, topAvg: avg(top), botAvg: avg(bot) };
  }).sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  const gs = {};
  top.forEach(x => Object.keys(x.st.genres).forEach(g => gs[g] = (gs[g] || 0) + 1 / top.length));
  bot.forEach(x => Object.keys(x.st.genres).forEach(g => gs[g] = (gs[g] || 0) - 1 / (bot.length || 1)));
  return { n: rows.length, feats, genres: Object.entries(gs).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), top: sorted.slice(0, 3).map(x => x.r.name) };
}
function popularityText(L){
  if (!L) return "";
  const up = L.feats.filter(f => f.c >= 0.3), down = L.feats.filter(f => f.c <= -0.3);
  return `[참고 작품 ${L.n}개로 배운 인기 공식]
- 인기작일수록 큰 것: ${up.map(f => `${f.label}(인기작 평균 ${Math.round(f.topAvg * 10) / 10}${f.unit})`).join(", ") || "뚜렷하지 않음"}
- 인기작일수록 작은 것: ${down.map(f => `${f.label}(인기작 평균 ${Math.round(f.topAvg * 10) / 10}${f.unit})`).join(", ") || "뚜렷하지 않음"}
- 인기작에 많은 장르: ${L.genres.map(g => g[0]).slice(0, 4).join(", ") || "-"}`;
}
function askRefPop(r, after){
  const c = h("input", { type:"text", value: r.pop && r.pop.chats ? r.pop.chats : "", placeholder:"예) 1.2만, 3400" });
  const l = h("input", { type:"text", value: r.pop && r.pop.likes ? r.pop.likes : "", placeholder:"예) 850" });
  const n = h("input", { type:"text", value: r.name });
  const a = h("input", { type:"text", value: r.author || "", placeholder:"제작자 닉네임" });
  openSheet("✏️ 작품 정보", [lab("이름", n), lab("제작자", a), lab("대화 수", c), lab("좋아요 수", l),
    h("button", { class:"btn p", style:"width:100%;margin-top:10px", onclick:() => { r.name = n.value.trim() || r.name; r.author = a.value.trim(); r.pop = { chats: parseKNum(c.value), likes: parseKNum(l.value) }; save(); closeSheet(); after && after(); } }, "저장")]);
}
function refSummary(r){ return `《${r.name}》${r.author ? " by " + r.author : ""}${r.pop && r.pop.chats ? ` · 대화 ${fmtNum(r.pop.chats)}` : ""}\n` + plotAll(r).slice(0, 1800); }
function compareSheet(r){
  const me = W(), a = scoreOf(me), b = scoreOf(r);
  openSheet("⚖️ 내 작품 vs " + r.name, [
    h("div", { class:"tiny", style:"margin-bottom:6px" }, "제타에서 누구나 볼 수 있는 부분(소개·시작 메시지·갈등)만 같은 기준으로 비교해요."),
    h("div", { class:"row", style:"margin-bottom:6px" }, h("span", { class:"grow tiny" }, "✦ " + me.name + " — " + a.visGrade + " " + a.visTotal), h("span", { class:"tiny" }, "👥 " + b.visGrade + " " + b.visTotal)),
    ...a.items.map((x, i) => !x.vis ? null : h("div", { style:"margin-bottom:8px" },
      h("div", { class:"row" }, h("b", { class:"grow", style:"font-size:13px" }, x.label), h("span", { class:"tiny" }, `나 ${x.got} · 상대 ${b.items[i].got} / ${x.max}`)),
      bar(x.got, x.max, "var(--ac)"), bar(b.items[i].got, b.items[i].max, "var(--ac2)"))),
    h("div", { class:"tiny" }, "분홍 = 내 작품, 보라 = 참고 작품."),
    h("button", { class:"btn v", style:"width:100%;margin-top:8px", onclick:() => { closeSheet(); aiLearnFrom([r]); } }, "🤖 이 작품에서 배워서 내 작품 개선안 받기")
  ]);
}
function aiRefWhy(r){
  aiRun("인기 비결 분석 · " + r.name, [{ role:"system", content:SYS_WRITER }, { role:"user", content:
`아래는 제타에 올라온 다른 작가의 작품이야${r.pop && r.pop.chats ? ` (대화 수 ${fmtNum(r.pop.chats)}${r.pop.likes ? ", 좋아요 " + fmtNum(r.pop.likes) : ""})` : ""}. 숨겨진 설정은 없고 보이는 부분만 있어.
다음을 짧고 구체적으로 분석해줘:
■ 클릭하게 만드는 훅 (이름·소개·첫 장면)
■ 대화가 오래 이어지게 만드는 장치
■ 캐릭터 매력 포인트
■ 내가 빌려올 수 있는 '구조와 장치' 3가지 (문장·설정을 베끼지 말고 원리만)
■ 이 작품의 약점·빈틈 (내가 더 잘할 수 있는 곳)

${refSummary(r)}` }]);
}
function aiLearnFrom(refs){
  const me = W(), L = learnPopularity();
  aiRun("참고 작품에서 배우기 → " + me.name, [{ role:"system", content:SYS_WRITER }, { role:"user", content:
`아래 [참고 작품]들의 성공 원리를 분석해서, [내 작품]을 더 인기 있게 만들 구체적인 개선안 6개를 줘.
규칙: 참고 작품의 문장·이름·고유 설정을 그대로 가져오지 말고 원리(구조·장치·리듬)만 내 작품에 맞게 바꿔 적용. 각 개선안은 "어느 칸을 → 어떻게" 형식 + 바로 쓸 수 있는 예시 문장 하나.

${popularityText(L)}

[참고 작품]
${refs.map(refSummary).join("\n\n").slice(0, 9000)}

[내 작품]
${plotAll(me) || "(아직 비어 있음 — 이름: " + me.name + ")"}` }], { maxTokens: 8000 });
}
function tabRefs(box){
  const refs = S.refs || (S.refs = []);
  const L = learnPopularity();
  const goImport = () => { S.importTarget = "ref"; S.dnaTab = "import"; save(); renderApp("dna"); };
  box.append(h("div", { class:"card" },
    h("div", { class:"muted" }, "다른 사람의 제타 작품을 모아 분석해요. 캡처나 보이는 글을 넣고 대화 수를 적어 두면, 어떤 요소가 인기와 관련 있는지 계산해요."),
    h("div", { class:"btns" }, h("button", { class:"btn p", onclick: goImport }, "＋ 다른 작품 넣기 (붙여넣기·캡처)"),
      refs.length ? h("button", { class:"btn v", onclick:() => aiLearnFrom(refs.slice(0, 6)) }, "🤖 전부에서 배워서 내 작품 개선") : null)));
  // 인기 공식 학습
  const lc = h("div", { class:"card" }, h("h3", null, "🧠 인기 공식 학습"));
  if (!L) lc.append(h("div", { class:"muted" }, `대화 수가 적힌 참고 작품이 3개 이상 있으면 계산해요. (지금 ${refs.filter(r => popOf(r) > 0 && hasContent(r)).length}개)`));
  else {
    const me = featsOf(W());
    lc.append(h("div", { class:"tiny", style:"margin-bottom:8px" }, `참고 작품 ${L.n}개 · 순위 상관으로 계산 · 작품이 많을수록 정확해요`));
    const strong = L.feats.filter(f => Math.abs(f.c) >= 0.3);
    if (!strong.length) lc.append(h("div", { class:"muted" }, "아직 뚜렷한 공통점이 없어요. 작품을 더 넣어 보세요."));
    strong.slice(0, 6).forEach(f => {
      const mine = me.f[f.k], good = f.c > 0 ? mine >= f.topAvg * 0.85 : mine <= f.topAvg * 1.15;
      lc.append(h("div", { style:"margin-bottom:10px" },
        h("div", { class:"row" }, h("b", { class:"grow", style:"font-size:13.5px" }, (f.c > 0 ? "⬆ " : "⬇ ") + f.label), h("span", { class:"tiny" }, "관련도 " + Math.round(Math.abs(f.c) * 100) + "%")),
        bar(Math.abs(f.c), 1, f.c > 0 ? "var(--ok)" : "var(--warn)"),
        h("div", { class:"tiny", style:"margin-top:3px" }, `인기작 평균 ${Math.round(f.topAvg * 10) / 10}${f.unit} · 내 작품 ${Math.round(mine * 10) / 10}${f.unit} ${good ? "✅" : "→ " + (f.c > 0 ? "늘려 보세요" : "줄여 보세요")}`)));
    });
    if (L.genres.length) lc.append(h("div", { class:"tiny", style:"margin-top:4px" }, "인기작에 많은 장르: " + L.genres.slice(0, 4).map(g => g[0]).join(", ")));
    lc.append(h("div", { class:"tiny" }, "상위 작품: " + L.top.join(", ")));
  }
  box.append(lc);
  if (!refs.length){ box.append(h("div", { class:"card muted", style:"text-align:center" }, "아직 넣은 다른 작품이 없어요.")); return; }
  [...refs].sort((a, b) => popOf(b) - popOf(a)).forEach(r => {
    const sc = scoreOf(r);
    box.append(h("div", { class:"card" },
      h("div", { class:"row" }, h("div", { class:"grow" }, h("b", null, r.name), h("div", { class:"tiny" }, [r.author ? "by " + r.author : "", r.pop && r.pop.chats ? "💬 " + fmtNum(r.pop.chats) : "대화 수 미입력", r.pop && r.pop.likes ? "❤️ " + fmtNum(r.pop.likes) : ""].filter(Boolean).join(" · "))),
        h("div", { style:"text-align:center" }, h("div", { style:"font-family:'Black Han Sans';font-size:26px;line-height:1" }, sc.grade), h("div", { class:"tiny" }, sc.total + "점"), h("div", { class:"tiny", style:"font-size:10px" }, "보이는 부분 기준"))),
      (r.fields.intro || "").trim() ? h("div", { class:"tiny", style:"margin-top:6px;color:var(--tx2)" }, r.fields.intro.trim().slice(0, 120)) : null,
      h("div", { class:"btns" },
        h("button", { class:"btn sm v", onclick:() => aiRefWhy(r) }, "🤖 인기 비결"),
        h("button", { class:"btn sm", onclick:() => compareSheet(r) }, "⚖️ 내 작품과 비교"),
        h("button", { class:"btn sm", onclick:() => openSheet(r.name, [h("div", { class:"out", style:"max-height:60vh;overflow:auto" }, plotAll(r) || "(내용 없음)")]) }, "👁 내용"),
        h("button", { class:"btn sm", onclick:() => askRefPop(r, () => renderApp("dna")) }, "✏️ 정보"),
        h("button", { class:"btn sm d", onclick:() => confirmSheet("'" + r.name + "' 참고 작품을 지울까요?", "삭제", () => { S.refs = S.refs.filter(x => x !== r); save(); renderApp("dna"); }) }, "삭제"))));
  });
}
