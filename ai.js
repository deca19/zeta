"use strict";
/* =====================================================================
   제타 엔진 v2 — AI 계층
   · 클라우드: Gemini 3.6 Flash(ChatGPT 무료급) / DeepSeek V4 Flash / Kimi K2.6 /
               gpt-oss-120b (Groq·Cerebras·OpenRouter) / 직접 서버
   · 🚀 자동: 키가 있는 서버를 좋은 순서대로, 막히면 다음 서버로 자동 전환
   · 품질 모드: 빠름(1회) / 균형(초안→자기검토→수정) / 최고(초안 2개 동시→비교·합성)
   · 폰 내장: Qwen3.5 (WebGPU, 오프라인)
   ===================================================================== */

const AI_PROVIDERS = {
  gemini: { name:"Google Gemini", url:"https://generativelanguage.googleapis.com",
    models:[["gemini-3.6-flash","Gemini 3.6 Flash — 최신·추천"],["gemini-3.5-flash","Gemini 3.5 Flash"],["gemini-3.5-flash-lite","Gemini 3.5 Flash-Lite — 가장 빠름"]],
    keyUrl:"https://aistudio.google.com/apikey", eff:"top", noTemp:true, maxTok:16000,
    note:"ChatGPT 무료급 성능 · 무료 키 (분당·하루 횟수 제한)",
    steps:["아래 링크를 열고 구글 계정으로 로그인","'API 키 만들기 (Create API key)' 누르기","만들어진 키(AIza…로 시작)를 복사해서 위 칸에 붙여넣기"] },
  openrouter: { name:"OpenRouter", url:"https://openrouter.ai/api/v1/chat/completions",
    models:[["deepseek/deepseek-v4-flash:free","DeepSeek V4 Flash — 롤플레이 강자"],["moonshotai/kimi-k2.6:free","Kimi K2.6"],["openai/gpt-oss-120b:free","gpt-oss-120b"],["openrouter/free","무료 모델 자동 고르기"]],
    keyUrl:"https://openrouter.ai/keys", eff:"obj", maxTok:8000,
    note:"무료 모델 여러 개 · 하루 요청 수 제한 · 붐비면 느림",
    steps:["아래 링크를 열고 구글 계정으로 가입","Create API Key 누르기 (결제 정보 필요 없음)","만들어진 키(sk-or-…)를 복사해서 위 칸에 붙여넣기"] },
  groq: { name:"Groq", url:"https://api.groq.com/openai/v1/chat/completions",
    models:[["openai/gpt-oss-120b","gpt-oss-120b"]], keyUrl:"https://console.groq.com/keys", eff:"top", maxTok:8000,
    note:"가장 빠름 · 무료 키 (요청 수 제한)",
    steps:["아래 링크를 열고 구글 계정으로 가입","API Keys → Create API Key","만들어진 키(gsk_…)를 복사해서 위 칸에 붙여넣기"] },
  cerebras: { name:"Cerebras", url:"https://api.cerebras.ai/v1/chat/completions",
    models:[["gpt-oss-120b","gpt-oss-120b"]], keyUrl:"https://cloud.cerebras.ai", eff:"top", maxTok:8000,
    note:"아주 빠름 · 무료 키",
    steps:["아래 링크를 열고 가입","API Keys에서 키 만들기","만들어진 키(csk-…)를 복사해서 위 칸에 붙여넣기"] },
  custom: { name:"직접 서버", url:"http://localhost:11434/v1/chat/completions",
    models:[["gpt-oss:120b","gpt-oss:120b"]], keyUrl:"", eff:"none", maxTok:8000,
    note:"Ollama·LM Studio 등 OpenAI 호환 주소", steps:[] },
};
const AUTO_ORDER = ["gemini", "openrouter", "groq", "cerebras", "custom"];
const QUALITY = {
  fast:     { label:"⚡ 빠름",  desc:"한 번에 바로 써요." },
  balanced: { label:"⚖️ 균형",  desc:"초안을 쓴 뒤 스스로 검토하고 고쳐요. (2번 호출)" },
  best:     { label:"🏆 최고",  desc:"초안 두 개를 동시에 쓰고, 비교해서 장점만 합쳐요. 키가 2개 이상이면 서로 다른 AI가 하나씩 써요. (3번 호출)" },
  master:   { label:"💎 장인",  desc:"서로 다른 AI 초안 2개 → 합성 → 깐깐한 편집자 검수·수정까지. 가장 좋지만 가장 느려요. (4번 호출)" },
};

const LOCAL_MODELS = {
  base: { id:"onnx-community/Qwen3.5-0.8B-ONNX", label:"기본 0.8B", size:"약 1GB" },
  pro:  { id:"onnx-community/Qwen3.5-2B-ONNX",   label:"고급 2B",   size:"약 2GB" },
};
const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js";

function AIS(){
  const d = { engine:"off", provider:"auto", models:{}, urls:{}, effort:"low", temp:0.8, local:"base", userName:"유저", quality:"balanced", chatQuality:"fast" };
  if (!S.ai || typeof S.ai !== "object") S.ai = {};
  for (const k in d) if (!(k in S.ai)) S.ai[k] = d[k];
  if (!S.ai.models || typeof S.ai.models !== "object") S.ai.models = {};
  if (!S.ai.urls || typeof S.ai.urls !== "object") S.ai.urls = {};
  if (!["cloud","local","off"].includes(S.ai.engine)) S.ai.engine = "off";
  if (S.ai.provider !== "auto" && !AI_PROVIDERS[S.ai.provider]) S.ai.provider = "auto";
  if (!QUALITY[S.ai.quality]) S.ai.quality = "balanced";
  if (!LOCAL_MODELS[S.ai.local]) S.ai.local = "base";
  for (const k in S.ai.models) if (typeof S.ai.models[k] !== "string") delete S.ai.models[k];
  if (!["low","medium","high"].includes(S.ai.effort)) S.ai.effort = "low";
  if (!isFinite(+S.ai.temp)) S.ai.temp = 0.8;
  if (typeof S.ai.userName !== "string" || !S.ai.userName.trim()) S.ai.userName = "유저";
  return S.ai;
}
const KEYS_KEY = "zeta-studio-keys";
function getKeys(){ try { return JSON.parse(localStorage.getItem(KEYS_KEY)) || {}; } catch(e){ return {}; } }
function setKey(p, v){ const k = getKeys(); k[p] = v; try { localStorage.setItem(KEYS_KEY, JSON.stringify(k)); } catch(e){} }
function provOf(pid){
  const A = AIS(), P = AI_PROVIDERS[pid] || AI_PROVIDERS.gemini;
  return { pid, P, model: (A.models[pid] || P.models[0][0]).trim(), url: (pid === "custom" ? (A.urls.custom || P.url) : P.url).trim(), key: (getKeys()[pid] || "").trim() };
}
function readyProviders(){ const A = AIS(), k = getKeys(); return AUTO_ORDER.filter(p => p === "custom" ? !!(A.urls.custom || "").trim() : !!(k[p] || "").trim()); }
function inClaudeApp(){ return !!(window.claude && window.claude.use) || /claude|anthropic/i.test(location.hostname) || location.protocol === "blob:" || location.origin === "null"; }
const SITE_URL = "https://deca19.github.io/zeta/";
function aiOn(){ const A = AIS(); return A.engine === "cloud" || A.engine === "local"; }
function aiLabel(){
  const A = AIS();
  if (A.engine === "cloud"){
    if (A.provider === "auto"){ const r = readyProviders(); return r.length ? "🚀 자동 · " + r.map(p => provOf(p).model.replace(/:free$/, "")).join(" → ") : "🚀 자동 · 키 없음"; }
    const { P, model } = provOf(A.provider); return `${model.replace(/:free$/, "")} · ${P.name}`;
  }
  if (A.engine === "local") return "폰 내장 " + (LOCAL_MODELS[A.local] || LOCAL_MODELS.base).label;
  return "꺼짐 (요청문 복사)";
}

/* ---------------- 키 자동 인식 + 원클릭 세팅 ---------------- */
function detectKey(k){
  k = (k || "").trim().replace(/^["']|["']$/g, "");
  if (/^AIza[0-9A-Za-z_\-]{30,}$/.test(k)) return "gemini";
  if (/^sk-or-[0-9A-Za-z_\-]{30,}$/.test(k)) return "openrouter";
  if (/^gsk_[0-9A-Za-z]{30,}$/.test(k)) return "groq";
  if (/^csk-[0-9A-Za-z]{20,}$/.test(k)) return "cerebras";
  return "";
}
async function pasteFromClipboard(){ try { return await navigator.clipboard.readText(); } catch(e){ return ""; } }
function keyPasteBox(onDone){
  const inp = h("input", { type:"text", placeholder:"여기에 키를 붙여넣기 (AIza… / sk-or-… / gsk_…)", autocomplete:"off", autocapitalize:"off", spellcheck:"false" });
  const msg = h("div", { class:"tiny", style:"margin-top:6px" });
  const apply = async () => {
    const k = inp.value.trim().replace(/^["']|["']$/g, ""), pid = detectKey(k);
    if (!k) return;
    if (!pid){ msg.textContent = "⚠ 어떤 키인지 모르겠어요. 키 전체를 복사했는지 확인해 주세요."; return; }
    setKey(pid, k);
    const A = AIS(); A.engine = "cloud"; if (A.provider !== "auto" && A.provider !== pid) A.provider = "auto"; if (!A.provider) A.provider = "auto"; save();
    msg.textContent = "✅ " + AI_PROVIDERS[pid].name + " 키 저장 · 연결 확인 중…"; inp.value = "";
    try { const t = await callProvider(pid, [{ role:"user", content:"'연결 성공!'이라고만 말해줘." }], { maxTokens: 600 }); msg.textContent = "✅ " + AI_PROVIDERS[pid].name + " 연결 성공! AI가 켜졌어요. (" + t.trim().slice(0, 20) + ")"; toast("✅ " + AI_PROVIDERS[pid].name + " 연결 성공!"); }
    catch(e){ msg.textContent = "⚠ 키는 저장했지만 연결 확인 실패: " + e.message.slice(0, 160); toast("⚠ 연결 확인 실패 — 메시지를 확인해 주세요"); }
    onDone && onDone(pid);
  };
  let deb = null, busy = false;
  const applyOnce = async () => { if (busy) return; busy = true; try { await apply(); } finally { busy = false; } };
  inp.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => { if (detectKey(inp.value)) applyOnce(); }, 500); });
  inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing){ e.preventDefault(); clearTimeout(deb); applyOnce(); } });
  return h("div", null, h("div", { class:"row", style:"flex-wrap:nowrap" }, inp,
    h("button", { class:"btn v sm", onclick: async () => { const t = await pasteFromClipboard(); if (t){ inp.value = t.trim(); clearTimeout(deb); applyOnce(); } else if (inp.value.trim()){ clearTimeout(deb); applyOnce(); } else { inp.focus(); toast("칸을 길게 눌러 붙여넣기 해 주세요"); } } }, inp.value ? "✔ 확인" : "📋 붙여넣기")), msg);
}
function setupWizard(){
  const refresh = () => { closeSheet(); if (!location.hash || location.hash === "#") renderHome(); };
  openSheet("🚀 AI 켜기 — 복붙 2번이면 끝", [
    h("div", { class:"card", style:"margin-bottom:10px" },
      h("b", null, "① 무료 키 만들기 (구글 계정)"),
      h("div", { class:"tiny", style:"margin:4px 0 8px" }, "버튼을 누르면 구글 AI Studio가 열려요 → 'Create API key' (API 키 만들기) → 생긴 키 옆 복사 버튼"),
      h("a", { class:"btn p", href:"https://aistudio.google.com/apikey", target:"_blank", rel:"noopener", style:"text-decoration:none;display:block;text-align:center" }, "🔑 구글 키 만들러 가기 ↗")),
    h("div", { class:"card", style:"margin-bottom:10px" },
      h("b", null, "② 여기에 붙여넣기"),
      h("div", { class:"tiny", style:"margin:4px 0 8px" }, "붙여넣으면 어떤 키인지 알아서 알아보고, 바로 켜고 연결까지 확인해요."),
      keyPasteBox(() => setTimeout(() => { if (!location.hash || location.hash === "#") renderHome(); }, 50))),
    h("details", { class:"card" }, h("summary", null, "➕ (선택) 끊김 없이 쓰려면 키 하나 더"),
      h("div", { class:"tiny", style:"margin:6px 0" }, "구글 한도가 차면 자동으로 다음 AI로 넘어가요. 롤플레이 채팅은 DeepSeek가 특히 좋아요."),
      h("a", { class:"btn", href:"https://openrouter.ai/keys", target:"_blank", rel:"noopener", style:"text-decoration:none;display:block;text-align:center;margin-bottom:6px" }, "OpenRouter 키 만들기 ↗ (DeepSeek · Kimi 무료)"),
      h("a", { class:"btn", href:"https://console.groq.com/keys", target:"_blank", rel:"noopener", style:"text-decoration:none;display:block;text-align:center;margin-bottom:8px" }, "Groq 키 만들기 ↗ (gpt-oss-120b, 가장 빠름)"),
      keyPasteBox()),
    h("div", { class:"tiny", style:"margin-top:8px" }, "🔒 키는 이 폰 브라우저에만 저장돼요. Claude 앱 안에서는 외부 연결이 막혀 있으니 deca19.github.io/zeta 에서 써 주세요.")
  ]);
}
function setupCard(){
  const A = AIS();
  if (inClaudeApp()) return h("a", { class:"curwork", href: SITE_URL, target:"_blank", rel:"noopener", style:"text-decoration:none;color:var(--tx);margin-top:0;border-color:rgba(139,123,255,.5);background:rgba(139,123,255,.12)" },
    h("div", { style:"font-size:26px" }, "🌐"),
    h("div", { class:"grow" }, h("div", { class:"nm" }, "AI는 내 사이트에서"), h("div", { class:"lbl" }, "Claude 앱 안에선 AI 연결이 막혀요 → deca19.github.io/zeta")),
    h("div", { class:"chip" }, "열기 ↗"));
  if (A.engine === "local" || (readyProviders().length > 0 && A.engine !== "off")) return null;
  return h("button", { class:"curwork", style:"width:100%;text-align:left;border-color:rgba(255,93,143,.5);background:rgba(255,93,143,.12);margin-top:0", onclick: setupWizard },
    h("div", { style:"font-size:26px" }, "🚀"),
    h("div", { class:"grow" }, h("div", { class:"nm" }, "AI 켜기 (2분)"), h("div", { class:"lbl" }, "무료 키 만들기 → 붙여넣기. 끝.")),
    h("div", { class:"chip" }, "시작"));
}

/* ---------------- 캡처 읽기 (Gemini 비전) ---------------- */
async function imgToB64(file){
  const im = await loadImg(file), c = toCanvas(im, 1600);
  const url = c.toDataURL("image/jpeg", 0.88);
  return { mime: "image/jpeg", data: url.split(",")[1] };
}
async function visionRead(files, prompt){
  const A = AIS(), key = (getKeys().gemini || "").trim();
  if (!key) throw new Error("캡처 읽기는 구글 Gemini 키가 필요해요. 🚀 AI 켜기에서 구글 키를 넣어 주세요.");
  const parts = [{ text: prompt }];
  for (const f of files.slice(0, 8)) parts.push({ inlineData: await imgToB64(f) });
  const base = (A.urls.gemini || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const models = [provOf("gemini").model].concat(AI_PROVIDERS.gemini.models.map(m => m[0])).filter((m, i, a) => a.indexOf(m) === i);
  let last = null;
  for (const model of models){
    let res;
    try { res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents:[{ role:"user", parts }], generationConfig:{ maxOutputTokens: 16000 } }) }); }
    catch(e){ throw new Error(inClaudeApp() ? "Claude 앱 안에서는 외부 연결이 막혀 있어요. " + SITE_URL + " 에서 열어 주세요." : "구글 서버에 연결하지 못했어요."); }
    const t = await res.text();
    if (!res.ok){ last = new Error("캡처 읽기 실패 (" + res.status + "): " + t.slice(0, 160)); if (res.status === 404 || res.status === 429) continue; throw last; }
    let j; try { j = JSON.parse(t); } catch(e){ throw new Error("캡처 읽기 응답을 이해하지 못했어요"); }
    const out = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || "").join("");
    if (out.trim()) return out;
    last = new Error("캡처에서 글자를 못 읽었어요");
  }
  throw last;
}

/* ---------------- Gemini 전용 (구글 기본 API, 브라우저에서 바로 호출) ---------------- */
async function geminiCall(messages, o, stripped, modelOverride){
  const A = AIS(), { P, key } = provOf("gemini"), model = modelOverride || provOf("gemini").model;
  if (!key) throw new Error("Google Gemini API 키가 없어요. 🧠 AI 엔진에서 넣어 주세요.");
  const sys = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const contents = [];
  for (const m of messages){
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "model" : "user", last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n\n" + m.content; else contents.push({ role, parts:[{ text: m.content }] });
  }
  if (!contents.length || contents[0].role === "model") contents.unshift({ role:"user", parts:[{ text:"(시작)" }] });
  if (contents[contents.length - 1].role === "model") contents.push({ role:"user", parts:[{ text:"(계속)" }] });
  const body = { contents, generationConfig: { maxOutputTokens: Math.max(o.maxTokens || 0, P.maxTok) } };
  if (sys) body.systemInstruction = { parts:[{ text: sys }] };
  if (!stripped) body.generationConfig.thinkingConfig = { thinkingLevel: A.effort };
  const base = (A.urls.gemini || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  let res;
  try { res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: o.signal }); }
  catch(e){ if (e.name === "AbortError") throw e; const err = new Error(inClaudeApp() ? "Claude 앱 안에서는 외부 AI 연결이 막혀 있어요. " + SITE_URL + " 에서 열어 주세요." : "Google Gemini 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. (" + e.message + ")"); err.soft = true; throw err; }
  if (!res.ok){
    let msg = ""; try { const t = await res.text(); try { const j = JSON.parse(t); const x = Array.isArray(j) ? j[0] : j; msg = (x.error && x.error.message) || t; } catch(_){ msg = t; } } catch(_){}
    if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg) || res.status === 401 || res.status === 403){ const e = new Error("Google Gemini API 키가 틀렸거나 권한이 없어요."); e.soft = true; throw e; }
    if (res.status === 400 && !stripped) return geminiCall(messages, o, true, modelOverride);
    const err = new Error(res.status === 429 ? "Google Gemini 무료 한도를 잠깐 넘었어요. 1분쯤 뒤에 다시 해 주세요. (자동 모드면 다른 서버로 넘어가요)" : res.status === 404 ? "Google Gemini에 이 모델이 없어요: " + model : "Google Gemini 오류 " + res.status + ": " + String(msg).slice(0, 200));
    err.soft = true; err.status = res.status; err.raw = String(msg); throw err;
  }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "", acc = "", thinking = false, block = "";
  for (let fin = false; !fin;){
    const { done, value } = await rd.read();
    if (done){ fin = true; buf += dec.decode() + "\n"; } else buf += dec.decode(value, { stream:true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0){
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let j; try { j = JSON.parse(line.slice(5).trim()); } catch(e){ continue; }
      if (j.error){ const e = new Error("Google Gemini 오류: " + (j.error.message || "").slice(0, 200)); e.soft = !acc; e.got = !!acc; e.raw = j.error.message || ""; e.status = j.error.code || 0; throw e; }
      if (j.promptFeedback && j.promptFeedback.blockReason) block = j.promptFeedback.blockReason;
      const c = j.candidates && j.candidates[0];
      if (!c) continue;
      if (c.finishReason && /SAFETY|PROHIBITED|BLOCK/.test(c.finishReason)) block = c.finishReason;
      for (const part of (c.content && c.content.parts) || []){
        if (part.thought){ if (!acc && !thinking){ thinking = true; o.onThink && o.onThink(); } continue; }
        if (part.text){ acc += part.text; o.onText && o.onText(acc); }
      }
    }
  }
  if (!acc.trim()){ const e = new Error(block ? "Gemini 안전 필터에 걸려 답을 못 받았어요 (" + block + "). 표현을 바꿔 보세요." : "Google Gemini에서 빈 답이 왔어요."); e.soft = true; throw e; }
  return acc;
}

/* ---------------- 서버 하나 호출 (+ 같은 서버 안에서 모델 자동 대체) ---------------- */
async function callProvider(pid, messages, o){
  const A = AIS(), P = AI_PROVIDERS[pid], cur = provOf(pid).model;
  try { return await callProviderOnce(pid, messages, o); }
  catch(e){
    // 모델이 없거나(404) 무료 한도가 0인 모델(429 quota)이면 같은 서버의 다른 무료 모델로 자동 대체
    const quota = e.status === 429 && /quota|limit: ?0|free.?tier|RESOURCE_EXHAUSTED|rate-limited upstream|no endpoints/i.test(e.raw || "");
    if (e.name === "AbortError" || e.got || !(e.status === 404 || quota) || !P || !P.models.some(m => m[0] === cur)) throw e;
    for (const [m] of P.models){
      if (m === cur) continue;
      try {
        const t = await callProviderOnce(pid, messages, o, false, m);
        A.models[pid] = m; save();
        try { toast(`${cur.replace(/:free$/, "")} 대신 ${m.replace(/:free$/, "")}로 자동 전환했어요`); } catch(_){}
        return t;
      } catch(e2){ if (e2.name === "AbortError" || e2.got) throw e2; }
    }
    throw e;
  }
}
async function callProviderOnce(pid, messages, o, stripped, modelOverride){
  if (pid === "gemini") return geminiCall(messages, o, stripped, modelOverride);
  const A = AIS(), { P, url, key } = provOf(pid), model = modelOverride || provOf(pid).model;
  if (!key && pid !== "custom") throw new Error(P.name + " API 키가 없어요. 🧠 AI 엔진에서 넣어 주세요.");
  const body = { model, messages, stream:true, max_tokens: Math.max(o.maxTokens || 0, P.maxTok) };
  if (!stripped){
    if (!P.noTemp) body.temperature = o.temperature != null ? o.temperature : A.temp;
    if (P.eff === "top") body.reasoning_effort = A.effort;
    if (P.eff === "obj") body.reasoning = { effort: A.effort };
  }
  const headers = { "Content-Type":"application/json" };
  if (key) headers.Authorization = "Bearer " + key;
  if (pid === "openrouter") headers["X-Title"] = "Zeta Studio";
  let res;
  try { res = await fetch(url, { method:"POST", headers, body: JSON.stringify(body), signal: o.signal }); }
  catch(e){
    if (e.name === "AbortError") throw e;
    const err = new Error(inClaudeApp() ? "Claude 앱 안에서는 외부 AI 연결이 막혀 있어요. " + SITE_URL + " 에서 열어 주세요." : P.name + " 서버에 연결하지 못했어요. 인터넷 연결을 확인하거나 주소를 확인해 주세요. (" + e.message + ")"); err.soft = true; throw err;
  }
  if (!res.ok){
    let msg = ""; try { const t = await res.text(); try { const j = JSON.parse(t); const x = Array.isArray(j) ? j[0] : j; msg = (x.error && (x.error.message || x.error)) || t; } catch(_){ msg = t; } } catch(_){}
    if (res.status === 400 && !stripped) return callProviderOnce(pid, messages, o, true, modelOverride);   // 선택 옵션 빼고 한 번 더
    const err = new Error(
      res.status === 401 || res.status === 403 ? P.name + " API 키가 틀렸거나 권한이 없어요. (" + res.status + ")" :
      res.status === 429 ? P.name + " 무료 한도를 잠깐 넘었어요. 1분쯤 뒤에 다시 해 주세요." :
      res.status === 404 ? P.name + "에 이 모델이 없어요: " + model :
      P.name + " 오류 " + res.status + ": " + String(msg).slice(0, 200));
    err.soft = res.status === 429 || res.status >= 500 || res.status === 404 || res.status === 402;
    err.status = res.status; err.raw = String(msg);
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  if (!res.body || ct.includes("application/json")){
    const j = await res.json(); const t = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    if (!t.trim()){ const e = new Error(P.name + "에서 빈 답이 왔어요."); e.soft = true; throw e; }
    o.onText && o.onText(t); return t;
  }
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "", acc = "", thinking = false;
  for (let fin = false; !fin;){
    const { done, value } = await rd.read();
    if (done){ fin = true; buf += dec.decode() + "\n"; } else buf += dec.decode(value, { stream:true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0){
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim(); if (data === "[DONE]") continue;
      let j; try { j = JSON.parse(data); } catch(e){ continue; }
      if (j.error){ const e = new Error(P.name + " 오류: " + (j.error.message || JSON.stringify(j.error)).slice(0, 200)); e.soft = !acc; e.got = !!acc; e.raw = JSON.stringify(j.error); e.status = (j.error.code && +j.error.code) || 0; throw e; }
      const d = j.choices && j.choices[0] && j.choices[0].delta; if (!d) continue;
      if (d.content){ acc += d.content; o.onText && o.onText(acc); }
      else if ((d.reasoning || d.reasoning_content) && !acc && !thinking){ thinking = true; o.onThink && o.onThink(); }
    }
  }
  if (!acc.trim()){ const e = new Error(P.name + "에서 빈 답이 왔어요. 생각 깊이를 '낮음'으로 해 보세요."); e.soft = true; throw e; }
  return acc;
}

/* ---------------- 클라우드: 자동 전환 포함 ---------------- */
async function cloudChat(messages, o){
  const A = AIS();
  if (A.provider !== "auto") return callProvider(A.provider, messages, o);
  const list = readyProviders();
  if (!list.length) throw new Error("🚀 자동 모드인데 넣은 키가 없어요. 🧠 AI 엔진에서 서버 키를 하나 이상 넣어 주세요.");
  let last = null;
  for (const pid of list){
    let got = false;
    const oo = Object.assign({}, o, { onText: t => { got = true; o.onText && o.onText(t); } });
    try { o.onProvider && o.onProvider(pid); return await callProvider(pid, messages, oo); }
    catch(e){
      if (e.name === "AbortError" || got) throw e;
      last = e;   // 어떤 이유든 다음 서버로 넘어감
    }
  }
  throw last;
}

/* ---------------- 폰 내장 엔진 (WebGPU, 작업자) ---------------- */
const LOCAL = { worker:null, ready:false, loading:null, pct:0, err:"", key:"" };
const LOCAL_SRC = [
  "let tf=null,processor=null,model=null;",
  "self.onmessage=async(e)=>{const m=e.data,id=m.id;try{",
  " if(m.type==='load'){tf=tf||await import(m.tfUrl);tf.env.allowLocalModels=false;",
  "  const progress=(p)=>{if(p&&p.status==='progress'&&p.total)self.postMessage({id,type:'progress',file:p.file,loaded:p.loaded||0,total:p.total});};",
  "  processor=await tf.AutoProcessor.from_pretrained(m.model,{progress_callback:progress});",
  "  model=await tf.Qwen3_5ForConditionalGeneration.from_pretrained(m.model,{dtype:m.dtype,device:m.device,progress_callback:progress});",
  "  self.postMessage({id,type:'done'});",
  " }else if(m.type==='gen'){",
  "  const msgs=m.messages.map(x=>({role:x.role,content:[{type:'text',text:x.content}]}));",
  "  const text=processor.apply_chat_template(msgs,{add_generation_prompt:true,enable_thinking:false});",
  "  const inputs=await processor(text);let acc='',last=0;",
  "  const streamer=new tf.TextStreamer(processor.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:(p)=>{acc+=p;const n=Date.now();if(n-last>150){last=n;self.postMessage({id,type:'piece',text:acc});}}});",
  "  const out=await model.generate({...inputs,max_new_tokens:m.maxTokens,do_sample:true,temperature:m.temp,top_p:0.9,top_k:40,repetition_penalty:1.1,streamer});",
  "  const dec=processor.batch_decode(out.slice(null,[inputs.input_ids.dims.at(-1),null]),{skip_special_tokens:true});",
  "  self.postMessage({id,type:'done',text:dec[0]||acc});",
  " }}catch(err){self.postMessage({id,type:'error',message:String((err&&err.message)||err)});}};"
].join("\n");
let localReq = 0; const localPending = new Map();
function localWorker(){
  if (LOCAL.worker) return LOCAL.worker;
  const w = new Worker(URL.createObjectURL(new Blob([LOCAL_SRC], { type:"text/javascript" })), { type:"module" });
  w.onmessage = e => { const m = e.data, p = localPending.get(m.id); if (!p) return;
    if (m.type === "progress"){ p.onProgress && p.onProgress(m); return; }
    if (m.type === "piece"){ p.onPiece && p.onPiece(m.text); return; }
    localPending.delete(m.id); if (m.type === "error") p.reject(new Error(m.message)); else p.resolve(m); };
  w.onerror = e => { localPending.forEach(p => p.reject(new Error((e && e.message) || "엔진 작업자 오류"))); localPending.clear(); try { w.terminate(); } catch(_){} LOCAL.worker = null; LOCAL.ready = false; };
  LOCAL.worker = w; return w;
}
function localCall(msg, hd){ const id = ++localReq; return new Promise((resolve, reject) => { localPending.set(id, Object.assign({ resolve, reject }, hd || {})); localWorker().postMessage(Object.assign({ id }, msg)); }); }
function loadLocal(onPct){
  const A = AIS();
  if (LOCAL.ready && LOCAL.key === A.local) return Promise.resolve(true);
  if (LOCAL.loading) return LOCAL.loading;
  if (LOCAL.worker && LOCAL.key !== A.local){ try { LOCAL.worker.terminate(); } catch(e){} LOCAL.worker = null; LOCAL.ready = false; }
  const files = new Map();
  LOCAL.err = ""; LOCAL.pct = 0;
  LOCAL.loading = (async () => {
    try {
      try { navigator.storage && navigator.storage.persist && await navigator.storage.persist(); } catch(e){}
      const device = navigator.gpu ? "webgpu" : "wasm";
      await localCall({ type:"load", tfUrl:TF_URL, model:LOCAL_MODELS[A.local].id, device,
        dtype:{ embed_tokens:"q4", vision_encoder: device === "webgpu" ? "fp16" : "q8", decoder_model_merged:"q4" } },
        { onProgress: p => { files.set(p.file, [p.loaded, p.total]); let a = 0, t = 0; files.forEach(([x, y]) => { a += x; t += y; }); LOCAL.pct = t ? Math.round(a/t*100) : 0; onPct && onPct(LOCAL.pct); } });
      LOCAL.ready = true; LOCAL.key = A.local; return true;
    } catch(e){
      const m = String(e && e.message || e);
      LOCAL.err = /memory|OOM|allocation/i.test(m) ? "폰 메모리가 부족해요. 기본 0.8B를 쓰거나 다른 앱을 닫아 주세요." : /fetch|network|Failed|NetworkError|import/i.test(m) ? "엔진 파일을 받지 못했어요. Claude 앱 안에서는 막혀 있어요 — GitHub Pages 주소로 열어 주세요." : m.slice(0, 200);
      return false;
    } finally { LOCAL.loading = null; }
  })();
  return LOCAL.loading;
}
async function localChat(messages, o){
  if (!(await loadLocal())) throw new Error(LOCAL.err || "폰 엔진을 못 켰어요");
  // 작은 모델이라 앞부분을 줄여 줌
  const sys = messages.filter(m => m.role === "system").map(m => m.content).join("\n").slice(0, 2400);
  const rest = messages.filter(m => m.role !== "system").slice(-6).map(m => ({ role:m.role, content:m.content.slice(-1600) }));
  const r = await localCall({ type:"gen", messages: (sys ? [{ role:"system", content:sys }] : []).concat(rest), maxTokens: Math.min(900, o.maxTokens || 700), temp: o.temperature != null ? o.temperature : AIS().temp }, { onPiece: t => o.onText && o.onText(t) });
  o.onText && o.onText(r.text); return r.text;
}


async function aiChat(messages, o){
  o = o || {};
  const A = AIS();
  if (A.engine === "cloud") return cloudChat(messages, o);
  if (A.engine === "local") return localChat(messages, o);
  throw new Error("AI_OFF");
}

/* ---------------- 품질 파이프라인 ---------------- */
const SYS_WRITER = `너는 한국 AI 캐릭터 채팅 플랫폼 '제타(zeta)'의 베테랑 캐릭터 제작자이자 웹소설·웹툰 작가다.
- 장면이 눈앞에 그려지듯 구체적으로 쓴다. 추상적인 형용사보다 행동·사물·감각으로 보여준다.
- AI가 캐릭터를 일관되게 연기할 수 있게 설정은 명확하고 서로 모순 없게 쓴다.
- 뻔한 클리셰는 한 번 비튼다. 코미디는 과장된 반응과 타이밍으로 웃긴다.
- 자연스러운 한국어 구어체 리듬을 살리고, 번역투·같은 어미 반복을 피한다.
- 요청한 결과만 출력한다. 앞뒤 인사말·해설·마크다운 제목(#)·굵게(**)는 쓰지 않는다.
- {{user}}, {{char}} 표기는 그대로 둔다. 성적인 묘사는 쓰지 않는다.`;
const REVISE = `방금 쓴 결과를 깐깐한 편집자 눈으로 검토해.
1) 원래 요청의 형식·분량·규칙을 하나도 빠짐없이 지켰는지
2) 설정끼리 모순, 애매해서 AI가 헷갈릴 표현
3) 밋밋하거나 뻔한 표현, 번역투, 같은 어미·단어 반복
문제를 모두 고친 최종본만 출력해. 형식은 원래 요청과 똑같이 지키고, 검토 내용이나 설명은 절대 쓰지 마.`;
const REVISE_CHAT = `(진행자 메모 — 유저가 보낸 말이 아님) 방금 네 답을 연기 규칙에 비춰 다시 써라: 유저의 대사·행동을 대신 쓴 부분은 지우고, 직전 답들과 겹치는 표현·어미는 바꾸고, 이야기가 한 걸음 나아가게 하고, 캐릭터 말투와 설정을 정확히 지켜라. 고친 최종 답만 캐릭터로서 출력하고 이 메모나 검토 내용은 절대 언급하지 마.`;
const MERGE = (req, a, b) => `아래는 같은 요청에 대한 초안 두 개야. 두 초안을 비교해서 더 생생하고, 더 재미있고, 요청 조건을 더 잘 지킨 부분을 골라 하나의 최고 결과로 합쳐. 어색한 문장은 다듬어.
원래 요청의 형식을 정확히 지키고, 비교 설명 없이 결과만 출력해.

[원래 요청]
${req}

[초안 A]
${a}

[초안 B]
${b}`;
async function aiQuality(messages, o, stage){
  const A = AIS();
  const q = (o.fast || A.engine === "local") ? "fast" : (o.quality || A.quality || "balanced");
  stage = stage || (() => {});
  if (q === "fast"){ stage("작성 중"); return aiChat(messages, o); }
  const sys = messages.filter(m => m.role === "system"), req = promptText(messages);
  const draftOpt = Object.assign({}, o, { onText: t => o.onDraft && o.onDraft(t), onThink: null });
  const revise = (draft) => o.chat
    ? aiChat(messages.concat([{ role:"assistant", content:draft }, { role:"user", content:REVISE_CHAT }]), o)
    : aiChat(sys.concat([{ role:"user", content:req }, { role:"assistant", content:draft }, { role:"user", content:REVISE }]), o);
  if (q === "balanced"){
    stage("1/2 · 초안 쓰는 중");
    const draft = await aiChat(messages, draftOpt);
    stage("2/2 · 스스로 검토하고 고치는 중");
    return revise(draft);
  }
  const master = q === "master", N = master ? 4 : 3;
  // 키가 2개 이상이면 서로 다른 AI에게 초안을 하나씩 맡김 (다양성 ↑)
  const ready = A.engine === "cloud" && A.provider === "auto" ? readyProviders() : [];
  const via = (i, msgs, oo) => ready.length >= 2
    ? callProvider(ready[i % ready.length], msgs, oo).catch(e => { if (e.name === "AbortError") throw e; return aiChat(msgs, oo); })
    : aiChat(msgs, oo);
  const who = ready.length >= 2 ? ` (${provOf(ready[0]).model.replace(/:free$/, "")} + ${provOf(ready[1]).model.replace(/:free$/, "")})` : "";
  stage(`1/${N} · 초안 두 개를 동시에 쓰는 중${who}`);
  const mk = tag => sys.concat([{ role:"user", content: req + "\n\n(이번 초안 방향: " + tag + ")" }]);
  const rs = await Promise.allSettled([
    via(0, mk("설정에 충실하고 탄탄하게"), Object.assign({}, draftOpt, { temperature: 0.7 })),
    via(1, mk("과감하고 신선하게, 뻔한 전개는 비틀어서"), Object.assign({}, o, { onText:null, onThink:null, temperature: 1.0 }))
  ]);
  if (o.signal && o.signal.aborted){ const e = new Error("aborted"); e.name = "AbortError"; throw e; }
  const ok = rs.filter(r => r.status === "fulfilled" && r.value.trim()).map(r => r.value);
  if (!ok.length) throw rs[0].reason;
  if (ok.length === 1){ stage("2/2 · 검토하고 고치는 중"); return revise(ok[0]); }
  stage(`${N - (master ? 1 : 0)}/${N} · 두 초안을 비교해서 최고본으로 합치는 중`);
  if (!master) return aiChat(sys.concat([{ role:"user", content: MERGE(req, ok[0], ok[1]) }]), o);
  const merged = await aiChat(sys.concat([{ role:"user", content: MERGE(req, ok[0], ok[1]) }]), draftOpt);
  stage(`${N}/${N} · 깐깐한 편집자 검수·마무리 중`);
  return revise(merged);
}

/* ---------------- 공통 결과 창 ---------------- */
function promptText(messages){ return messages.filter(m => m.role !== "system").map(m => m.content).join("\n\n"); }
function aiRun(title, messages, opt){
  opt = opt || {};
  if (!aiOn()){
    copy(promptText(messages), "AI가 꺼져 있어 요청문을 복사했어요");
    setTimeout(() => toast("🧠 AI 엔진에서 켜면 바로 답이 나와요"), 1700);
    return;
  }
  if (typeof styleContext === "function" && messages[0] && messages[0].role === "system" && messages[0].content === SYS_WRITER){
    const sc = styleContext(promptText(messages));
    if (sc) messages = [{ role:"system", content: SYS_WRITER + "\n\n" + sc }].concat(messages.slice(1));
  }
  const styled = messages[0] && messages[0].content !== SYS_WRITER && messages[0].content.startsWith(SYS_WRITER);
  const out = h("div", { class:"out", style:"max-height:52vh;overflow:auto" }, "…");
  const stg = h("div", { class:"tiny", style:"margin-top:6px;color:var(--ac2)" });
  const st = h("div", { class:"tiny", style:"margin-top:2px" }, "⚡ " + aiLabel() + (styled ? " · ✍️ 내 스타일 반영" : ""));
  const btns = h("div", { class:"btns" });
  const qBox = h("div", { style:"margin-top:8px" });
  let ctrl = null, text = "";
  const drawQ = () => { if (opt.fast || AIS().engine === "local") return; const A = AIS(); qBox.replaceChildren(h("span", { class:"tiny" }, "품질 "), ...Object.entries(QUALITY).map(([k, q]) => h("button", { class:"pill" + (A.quality === k ? " on" : ""), onclick:() => { A.quality = k; save(); drawQ(); } }, q.label))); };
  const run = async () => {
    ctrl = new AbortController(); text = ""; out.textContent = "생각 중…"; btns.replaceChildren(stopBtn);
    const t0 = performance.now();
    try {
      text = await aiQuality(messages, { signal: ctrl.signal, maxTokens: opt.maxTokens, temperature: opt.temperature, fast: opt.fast,
        onProvider: pid => { st.textContent = "⚡ " + provOf(pid).model.replace(/:free$/, "") + " · " + AI_PROVIDERS[pid].name; },
        onThink: () => { if (!out.dataset.t) out.textContent = "깊게 생각하는 중…"; },
        onDraft: t => { out.style.opacity = ".55"; out.textContent = t; out.scrollTop = out.scrollHeight; },
        onText: t => { out.style.opacity = "1"; out.textContent = t; out.scrollTop = out.scrollHeight; } },
        s => { stg.textContent = "🔧 " + s; });
      text = text.trim(); out.textContent = text; out.style.opacity = "1";
      stg.textContent = "✅ 완료 (" + ((performance.now() - t0)/1000).toFixed(1) + "초)";
    } catch(e){
      out.style.opacity = "1";
      if (e.name === "AbortError"){ stg.textContent = "⏹ 멈춤"; text = out.textContent; }
      else { out.textContent = "⚠ " + e.message; stg.textContent = ""; text = ""; }
    }
    btns.replaceChildren(...[
      opt.onApply && text ? h("button", { class:"btn p", onclick:() => { const r = opt.onApply(text); if (r !== false){ closeSheet(); } else toast("결과 형식을 못 알아봤어요. 🔄 다시를 눌러 보세요"); } }, opt.applyLabel || "✔ 적용") : null,
      text ? h("button", { class:"btn", onclick:() => copy(text) }, "📋 복사") : null,
      h("button", { class:"btn", onclick: run }, "🔄 다시")
    ].filter(Boolean));
  };
  const stopBtn = h("button", { class:"btn d", onclick:() => ctrl && ctrl.abort() }, "⏹ 멈추기");
  openSheet("🤖 " + title, [out, stg, st, btns, qBox].concat(opt.extra || []));
  sheetCloseHook = () => { if (ctrl) try { ctrl.abort(); } catch(e){} };   // 창을 닫으면 AI도 멈춤 (무료 한도 아끼기)
  drawQ();
  run();
}

/* ---------------- 앱별 AI 기능 ---------------- */
function aiField(w, f, setv){
  aiRun(f.t + " 다듬기", [{ role:"system", content:SYS_WRITER }, { role:"user", content: aiFieldPrompt(w, f) }],
    { onApply: t => setv(t), applyLabel:"✔ 이 내용으로 바꾸기" });
}
function aiReview(w){
  aiRun("설정 검토", [{ role:"system", content:SYS_WRITER }, { role:"user", content: aiReviewPrompt(w) }]);
}
function parseSections(text){
  const map = {}, re = /【([^】]+)】\s*\n?([\s\S]*?)(?=\n?【[^】]+】|$)/g; let m;
  while ((m = re.exec(text))) map[m[1].replace(/\s/g, "")] = m[2].trim();
  return map;
}
function aiWhole(w, after){
  const inp = h("textarea", { style:"min-height:110px", placeholder:"예) 제국 최전선 기사단장이 죽어가다 성녀로 부활하는 코믹 TS물. 부하들은 아무도 눈치 못 챔. 유저는 부단장." , value: (w.fields.intro || "") });
  const go = () => {
    const concept = inp.value.trim(); if (!concept) return toast("콘셉트를 적어 주세요");
    closeSheet();
    const names = PLOT_FIELDS.map(f => "【" + f.t + "】").join("\n");
    const prompt = `아래 콘셉트로 제타 캐릭터를 완성해줘. 정확히 아래 10개 항목을 이 순서·이 제목 그대로 【】로 감싸서 출력하고, 다른 말은 쓰지 마.
${names}

규칙:
- 세계관·외모·성격·말투·{{user}}와의 관계·시작 상황은 "■ 항목: 내용" 줄 형식으로 촘촘하게
- 말투에는 실제 대사 예시를 따옴표로 3개 이상
- 시작 메시지는 *나레이션*과 "대사"를 섞어 400~700자, 마지막은 {{user}}가 반응하고 싶어지는 장면으로
- 예시 대화는 {{user}}: / {{char}}: 형식으로 3번 주고받기
- 한 줄 소개는 60자 이내, 목록에서 눈에 띄게

[이미 정해진 것 — 지키기]
${ctxOf(w) || "(없음)"}

[콘셉트]
${concept}`;
    aiRun("캐릭터 통째로 만들기", [{ role:"system", content:SYS_WRITER }, { role:"user", content:prompt }], {
      maxTokens: 6000, applyLabel:"✔ 빈 칸만 채우기",
      onApply: t => applyWhole(w, t, false, after),
      extra: [h("button", { class:"btn d", style:"margin-top:6px", onclick:() => { const o = document.querySelector("#sheet .out"), t = o ? o.textContent : ""; if (!/【[^】]+】/.test(t) || document.querySelector("#sheet .btn.d") && document.querySelector("#sheet .btns .btn.d")) return toast("생성이 끝난 뒤에 눌러 주세요"); if (applyWhole(w, t, true, after)) closeSheet(); } }, "⚠ 전부 덮어쓰기")]
    });
  };
  openSheet("🪄 캐릭터 통째로 만들기", [h("div", { class:"muted", style:"margin-bottom:8px" }, "콘셉트 한두 줄이면 10개 항목을 전부 써 줘요."), inp, h("button", { class:"btn p", style:"width:100%;margin-top:8px", onclick: go }, "🪄 만들기")]);
}
function applyWhole(w, text, overwrite, after){
  const sec = parseSections(text); let n = 0;
  for (const f of PLOT_FIELDS){
    const v = sec[f.t.replace(/\s/g, "")]; if (!v) continue;
    if (!overwrite && (w.fields[f.k] || "").trim()) continue;
    w.fields[f.k] = v; n++;
  }
  save(); toast(n ? n + "개 항목을 채웠어요" : "채울 항목을 못 찾았어요"); after && after();
  return n > 0;
}
function aiLore(w, after){
  const have = w.lore.map(x => x.k).filter(Boolean).join(", ");
  aiRun("키워드북 뽑기", [{ role:"system", content:SYS_WRITER }, { role:"user", content:
`아래 캐릭터 설정에서 대화 중 AI가 꼭 알아야 할 고유 설정(인물, 장소, 조직, 아이템, 능력, 사건, 비밀)을 6~12개 뽑아 키워드북 항목으로 만들어줘.
형식 (다른 말 금지):
[키워드, 별칭]
내용 1~3문장, 150자 이내

빈 줄로 항목 구분.${have ? "\n이미 있는 키워드는 빼기: " + have : ""}

${plotAll(w) || "(설정 없음 — 이름과 소개로 추측)"}` }], {
    applyLabel:"✔ 키워드북에 추가",
    onApply: t => { let n = 0; t.split(/\n(?=\s*\[)/).forEach(b => { const m = b.match(/^\s*\[([^\]]+)\]\s*\n?([\s\S]*)$/); if (m && m[2].trim()){ w.lore.push({ id:uid(), k:m[1].trim(), v:m[2].trim(), on:true }); n++; } }); save(); toast(n + "개 추가"); after && after(); return n > 0; }
  });
}
function aiStatusSuggest(w, apply){
  aiRun("상태창 추천", [{ role:"system", content:SYS_WRITER }, { role:"user", content:
`이 작품에 딱 맞는 상태창 항목을 4~7개 만들어줘. 재미 포인트가 되는 항목을 1~2개 꼭 넣어. 형식은 한 줄에 하나씩 "이모지 항목: 예시값". 다른 말 금지.

${plotAll(w) || w.name}` }], {
    applyLabel:"✔ 이 항목으로 바꾸기",
    onApply: t => { const items = t.split("\n").map(l => l.replace(/^[-•*\d.)\s]+/, "").trim()).filter(l => l.includes(":")).map(l => { const i = l.indexOf(":"); return { l: l.slice(0, i).trim(), e: l.slice(i + 1).trim() }; }); if (!items.length) return false; apply(items); return true; }
  });
}
function aiIdea(text){
  aiRun("작품 기획", [{ role:"system", content:SYS_WRITER }, { role:"user", content:
`제타 AI 캐릭터 채팅 작품 아이디어야. 이걸로
1) 제목 후보 5개 (클릭하고 싶게)
2) 한 줄 소개
3) 시작 상황 (3~4문장)
4) {{user}}의 역할 추천 2가지
5) 이 작품만의 웃음/긴장 포인트 3개
를 만들어줘.

${text}` }]);
}
function aiContiReview(w, e, text){
  aiRun("콘티 검토", [{ role:"system", content:SYS_WRITER }, { role:"user", content:`아래는 웹툰 《${w.name}》 ${e.title} 콘티야. 컷 흐름, 개그 타이밍, 대사 길이(컷당 말풍선 최대 3개, 효과음 최소)를 검토하고 고칠 점을 컷 번호로 짧게 알려줘. 마지막에 바꿔야 할 대사는 고친 대사로 제안해줘.\n\n` + text }]);
}
function aiConti(w, e, after){
  const inp = h("textarea", { style:"min-height:110px", placeholder:"이번 화에 일어날 일 (예: 여신이 반죽을 빚어 주인공 성별을 고치려다 더 꼬여버림)" });
  const n = h("input", { type:"number", value:12, min:3, max:40 });
  openSheet("🪄 AI 콘티 짜기", [inp, h("label", { class:"f" }, "컷 수"), n, h("button", { class:"btn p", style:"width:100%;margin-top:8px", onclick:() => {
    const plot = inp.value.trim(); if (!plot) return toast("내용을 적어 주세요");
    closeSheet();
    aiRun("콘티 짜기", [{ role:"system", content:SYS_WRITER }, { role:"user", content:
`세로 스크롤 웹툰 《${w.name}》 ${e.title} 콘티를 컷 ${+n.value || 12}개로 짜줘.
각 컷은 정확히 이 형식 (다른 말 금지):
#번호 [구도] 표정
장면: 누가 어디서 무엇을 하는지 한두 문장
💬 대사 (컷당 0~3개, 효과음은 거의 쓰지 않기)

구도는 다음 중 하나만: ${SHOTS.join(", ")}
표정은 짧은 한 단어 (당황, 웃음, 미소, 화남, 울음, 놀람, 무표정, 의기양양, 부끄러움, 멍함 등)

[작품 정보]
${ctxOf(w) || w.name}

[이번 화 내용]
${plot}` }], { maxTokens: 6000, applyLabel:"✔ 콘티에 넣기", onApply: t => {
      const cuts = t.split(/\n(?=\s*#\d+)/).map(b => {
        const hm = b.match(/#\d+\s*\[([^\]]+)\]\s*([^\n]*)/); if (!hm) return null;
        const scene = (b.match(/장면\s*[:：]\s*([^\n]+)/) || [])[1] || "";
        const bubbles = b.split("\n").filter(l => /^\s*💬/.test(l)).map(l => l.replace(/^\s*💬\s*/, "").trim()).filter(Boolean).slice(0, 3);
        const shot = SHOTS.find(s => hm[1].includes(s)) || "바스트샷";
        return { id:uid(), shot, face: hm[2].trim().slice(0, 12), scene: scene.trim(), bubbles: bubbles.length ? bubbles : [""], note:"", tags:"" };
      }).filter(Boolean);
      if (!cuts.length) return false;
      e.cuts = e.cuts.concat(cuts); save(); toast(cuts.length + "컷 추가"); after && after(); return true;
    } });
  } }, "🪄 콘티 짜기")]);
}
function aiTags(desc, apply){
  aiRun("영어 태그로 바꾸기", [{ role:"system", content:"You convert Korean scene descriptions into Danbooru-style English tags for anime image generation (PixAI). Output ONE line of comma-separated lowercase tags only. No explanations, no sentences, no NSFW tags." },
    { role:"user", content: desc }], { temperature:0.3, fast:true, applyLabel:"✔ 태그 칸에 넣기", onApply: t => { apply(t.split("\n")[0].replace(/^tags?\s*:\s*/i, "").trim()); return true; } });
}



/* ---------------- 앱: 🧠 AI 엔진 ---------------- */
VIEWS.ai = (body) => {
  const A = AIS();
  const card = (...k) => h("div", { class:"card" }, ...k);
  const status = h("div", { class:"muted" });
  const updStatus = () => status.replaceChildren(h("b", null, "지금 엔진: "), aiLabel());
  const engBox = h("div"), pane = h("div"), qBox = h("div");
  const drawEng = () => engBox.replaceChildren(...[["cloud","☁️ 클라우드 (무료 키)"],["local","📱 폰 내장"],["off","끄기"]].map(([k, t]) =>
    h("button", { class:"pill" + (A.engine === k ? " on" : ""), onclick:() => { A.engine = k; save(); drawEng(); drawPane(); updStatus(); } }, t)));
  const drawQ = () => qBox.replaceChildren(
    h("div", null, Object.entries(QUALITY).map(([k, q]) => h("button", { class:"pill" + (A.quality === k ? " on" : ""), onclick:() => { A.quality = k; save(); drawQ(); } }, q.label))),
    h("div", { class:"tiny", style:"margin-top:6px" }, QUALITY[A.quality].desc),
    h("label", { class:"check", style:"border:0" }, h("input", { type:"checkbox", checked: A.chatQuality === "balanced", onchange:e => { A.chatQuality = e.target.checked ? "balanced" : "fast"; save(); } }),
      h("div", null, "테스트 채팅도 자기검토 후 답하기 ", h("span", { class:"tiny" }, "(느려지지만 답이 좋아짐)"))));
  function testBtn(pid){
    const b = h("button", { class:"btn", onclick: async () => {
      b.disabled = true; b.textContent = "⏳ 확인 중…";
      try {
        const msgs = [{ role:"user", content:"한 문장으로 '연결 성공!'이라고 기사단장 말투로 말해줘." }];
        const t = pid ? await callProvider(pid, msgs, { maxTokens: 600 }) : await aiChat(msgs, { maxTokens: 600 });
        toast("✅ " + t.trim().slice(0, 40)); b.textContent = "✅ 연결됨";
      } catch(e){ b.textContent = "⚠ 실패"; openSheet("연결 실패", [h("div", { class:"out" }, e.message)]); }
      b.disabled = false; setTimeout(() => { b.textContent = "🔌 연결 테스트"; }, 2500);
    } }, "🔌 연결 테스트");
    return b;
  }
  function provCard(pid){
    const { P } = provOf(pid);
    const keyIn = h("input", { type:"password", value:getKeys()[pid] || "", placeholder: pid === "custom" ? "(필요하면) API 키" : "API 키 붙여넣기", autocomplete:"off", oninput:e => { setKey(pid, e.target.value.trim()); updStatus(); } });
    const cur = A.models[pid] || P.models[0][0];
    const isPreset = P.models.some(m => m[0] === cur);
    const custIn = h("input", { type:"text", value: isPreset ? "" : cur, placeholder:"모델 이름 직접 입력", style: isPreset ? "display:none;margin-top:6px" : "margin-top:6px", oninput:e => { A.models[pid] = e.target.value.trim(); save(); updStatus(); } });
    const mSel = sel(P.models.concat([["__custom", "직접 입력…"]]), isPreset ? cur : "__custom", v => {
      if (v === "__custom"){ custIn.style.display = ""; custIn.focus(); } else { custIn.style.display = "none"; A.models[pid] = v; save(); updStatus(); }
    });
    return h("div", null,
      h("div", { class:"tiny" }, P.note),
      pid === "custom" ? lab("주소 (OpenAI 호환 /chat/completions)", h("input", { type:"text", value:A.urls.custom || "", placeholder:P.url, oninput:e => { A.urls.custom = e.target.value.trim(); save(); updStatus(); } })) : null,
      lab("API 키", h("div", { class:"row", style:"flex-wrap:nowrap" }, keyIn, h("button", { class:"btn sm", onclick:() => { keyIn.type = keyIn.type === "password" ? "text" : "password"; } }, "👁"))),
      lab("모델", mSel), custIn,
      h("div", { class:"btns" }, testBtn(pid),
        P.keyUrl ? h("a", { class:"btn v", href:P.keyUrl, target:"_blank", rel:"noopener", style:"text-decoration:none" }, "🔑 무료 키 받기 ↗") : null),
      P.steps.length ? h("div", { class:"tiny", style:"margin-top:8px;line-height:1.7" }, P.steps.map((s, i) => h("div", null, (i + 1) + ". " + s)), h("div", null, P.keyUrl)) : null
    );
  }
  function drawPane(){
    pane.replaceChildren();
    if (A.engine === "off"){
      pane.append(card(h("div", { class:"muted" }, "AI 버튼을 누르면 ChatGPT·Claude 등에 붙여 넣을 요청문이 복사돼요. 바로 답을 받으려면 위에서 엔진을 켜세요.")));
      return;
    }
    if (A.engine === "local"){
      const bar = h("div", { class:"prog" }, h("i", { style:"width:" + (LOCAL.ready ? 100 : LOCAL.pct) + "%" }));
      const msg = h("div", { class:"tiny", style:"margin-top:6px" }, LOCAL.ready ? "✅ 준비됨" : LOCAL.err ? "⚠ " + LOCAL.err : "아직 안 받았어요");
      pane.append(card(h("h3", null, "📱 폰 내장 엔진 (오프라인)"),
        h("div", { class:"muted" }, "폰 안에서만 돌아가는 Qwen3.5 엔진이에요. 처음 한 번 받으면 인터넷 없이도 써요. 클라우드보다 글솜씨는 약해서 짧은 다듬기·대사용이에요."),
        h("label", { class:"f" }, "엔진 크기"),
        sel(Object.entries(LOCAL_MODELS).map(([k, m]) => [k, `${m.label} (${m.size})`]), A.local, v => { A.local = v; save(); drawPane(); updStatus(); }),
        h("div", { class:"tiny", style:"margin-top:6px" }, navigator.gpu ? "✅ 이 기기는 WebGPU를 지원해요 (빠름)" : "⚠ WebGPU가 없어 느리게 돌아요. 안드로이드 최신 Chrome / iOS 26+ Safari 추천"),
        bar, msg,
        h("div", { class:"btns" }, h("button", { class:"btn p", onclick: async e => {
          e.target.disabled = true; msg.textContent = "받는 중… 0%";
          const ok = await loadLocal(p => { bar.firstChild.style.width = p + "%"; msg.textContent = "받는 중… " + p + "%"; });
          msg.textContent = ok ? "✅ 준비됨" : "⚠ " + LOCAL.err; bar.firstChild.style.width = ok ? "100%" : "0"; e.target.disabled = false;
        } }, LOCAL.ready ? "다시 불러오기" : "⬇ 엔진 받기"), testBtn())));
      return;
    }
    const tabs = [["auto","🚀 자동"]].concat(AUTO_ORDER.map(p => [p, AI_PROVIDERS[p].name]));
    const inner = h("div");
    const drawInner = () => {
      inner.replaceChildren();
      if (A.provider === "auto"){
        const ready = readyProviders();
        inner.append(
          h("div", { class:"muted" }, "키를 넣어 둔 서버를 좋은 순서대로 써요. 한 곳이 한도에 걸리거나 막히면 자동으로 다음 서버로 넘어가요."),
          h("div", { style:"margin-top:8px" }, AUTO_ORDER.map((p, i) => h("div", { class:"check", style:"padding:7px 2px" },
            h("span", { style:"width:20px;text-align:center" }, ready.includes(p) ? "✅" : "▫️"),
            h("div", { class:"grow" }, (i + 1) + ". " + AI_PROVIDERS[p].name + " · " + provOf(p).model.replace(/:free$/, "")),
            h("button", { class:"btn sm", onclick:() => { A.provider = p; save(); drawPane(); updStatus(); } }, ready.includes(p) ? "설정" : "키 넣기")))),
          ready.length ? h("div", { class:"btns" }, testBtn()) : h("div", { class:"warnbox" }, "아직 키가 없어요. 'Google Gemini'부터 무료 키를 넣는 걸 추천해요 (ChatGPT 무료급)."));
      } else inner.append(provCard(A.provider));
    };
    pane.append(
      card(h("h3", null, "☁️ 서버와 모델"),
        h("div", null, tabs.map(([k, t]) => h("button", { class:"pill" + (A.provider === k ? " on" : ""), onclick:() => { A.provider = k; save(); drawPane(); updStatus(); } }, t))),
        h("div", { style:"margin-top:10px" }, inner),
        h("div", { class:"g2", style:"margin-top:6px" },
          lab("생각 깊이", sel([["low","낮음 (빠름)"],["medium","보통"],["high","높음 (느림·정교)"]], A.effort, v => { A.effort = v; save(); })),
          (() => { const l = h("span", null, A.temp); return h("div", null, h("label", { class:"f" }, "창의성 ", l), h("input", { type:"range", min:0, max:1.3, step:0.1, value:A.temp, oninput:e => { A.temp = +e.target.value; l.textContent = A.temp; save(); } })); })()),
        h("div", { class:"tiny", style:"margin-top:8px" }, "🔒 키는 이 기기 브라우저에만 저장돼요. 백업 파일에는 안 들어가요.")),
      card(h("h3", null, "🏆 품질 모드"), qBox)
    );
    drawInner(); drawQ();
  }
  body.append(
    card(h("div", { style:"display:flex;align-items:center;gap:12px" }, h("div", { style:"font-size:38px" }, "🧠"), h("div", null, h("div", { style:"font-weight:700;font-size:17px" }, "제타 엔진 v2"), status))),
    inClaudeApp() ? h("div", { class:"warnbox", style:"margin-bottom:12px" }, "⚠ 지금은 Claude 앱 안이라 외부 AI 연결이 막혀 있어요. 키는 여기 말고 ", h("a", { href:SITE_URL, target:"_blank", rel:"noopener", style:"color:inherit" }, "deca19.github.io/zeta"), " 에서 넣어 주세요.") : null,
    card(h("h3", null, "🔑 키 붙여넣기 (자동 인식)"), h("div", { class:"tiny", style:"margin-bottom:6px" }, "구글·OpenRouter·Groq·Cerebras 키 아무거나 붙여넣으면 알아서 맞는 칸에 넣고 켜요."), keyPasteBox(() => renderApp("ai")),
      h("div", { class:"btns" }, h("button", { class:"btn sm", onclick: setupWizard }, "🚀 처음 세팅 안내 보기"))),
    card(h("h3", null, "엔진 고르기"), engBox),
    pane,
    card(h("h3", null, "💬 테스트 채팅 설정"), lab("내 이름 ({{user}} 자리에 들어감)", h("input", { type:"text", value:A.userName, oninput:e => { A.userName = e.target.value || "유저"; save(); } }))),
    card(h("h3", null, "📍 어디서 열어야 AI가 되나요?"),
      h("div", { class:"muted" }, "Claude 앱 안에서 연 화면은 보안 때문에 외부 서버 연결이 막혀 있어서, AI 엔진은 GitHub Pages(내 사이트 주소)로 열었을 때 작동해요. GIF 공방·플롯 작성기 같은 나머지 기능은 어디서든 돼요."))
  );
  updStatus(); drawEng(); drawPane();
};

/* ---------------- 앱: 💬 캐릭터 테스트 채팅 ---------------- */
const CHAT_KEEP = 16;
function chatSystem(w, recent){
  const A = AIS(), nm = (w.fields.name || w.name || "캐릭터").trim(), U = A.userName;
  const sub = s => (s || "").split("{{char}}").join(nm).split("{{user}}").join(U);
  const F = k => (w.fields[k] || "").trim();
  const parts = [`너는 지금부터 AI 캐릭터 채팅 플랫폼 '제타'의 캐릭터 "${nm}"를 연기한다. 상대는 "${U}"(유저)이다.`,
`[연기 규칙]
- 너는 오직 "${nm}"이다. AI·설정·규칙에 대한 언급, 메타 발언은 절대 하지 않는다.
- *행동·표정·주변 묘사*와 "대사"를 섞어 3~6문단으로 쓴다. 소리·냄새·감촉 같은 감각을 하나 이상 넣는다.
- ${U}의 말과 행동에 구체적으로 반응하고, 매 턴 이야기를 한 걸음 앞으로 움직인다 (새 정보, 사건, 감정 변화 중 하나 이상).
- ${U}의 대사·행동·속마음은 절대 대신 쓰지 않는다. ${U}가 반응하고 싶어지는 지점에서 멈춘다.
- 직전 답변들의 표현, 문장 시작, 어미, 감탄사를 반복하지 않는다.
- 말투·호칭·성격·관계를 끝까지 지킨다. 설정에 없는 것은 세계관에 맞게 자연스럽게 지어낸다.
- 코미디는 과장된 반응과 타이밍으로, 진지한 장면은 절제해서. 성적인 묘사는 하지 않는다.`];
  for (const f of PLOT_FIELDS){ if (["first","example","name"].includes(f.k)) continue; if (F(f.k)) parts.push(`[${f.t.replace("{{user}}", U)}]\n${sub(F(f.k))}`); }
  if (F("example")) parts.push("[예시 대화 — 말투 참고용, 그대로 베끼지 말 것]\n" + sub(F("example")));
  if ((w.chatMem || "").trim()) parts.push("[지금까지의 이야기 요약 — 반드시 이어서 진행]\n" + w.chatMem.trim());
  const hay = recent.toLowerCase(), used = [];
  for (const x of w.lore){ if (!x.on || !x.v.trim()) continue; const ks = x.k.split(",").map(s => s.trim()).filter(Boolean); if (ks.some(k => hay.includes(k.toLowerCase()))){ used.push(ks[0]); parts.push(`[참고 설정: ${ks[0]}]\n${sub(x.v)}`); } }
  if (w.status.items.length) parts.push("[상태창 규칙]\n매 응답의 맨 마지막에 아래 형식의 상태창을 출력하고, 값은 상황에 맞게 바꾼다.\n" + sub(statusText(w.status)));
  return { sys: parts.join("\n\n"), used };
}
async function chatRemember(w){
  w.chatMemUpto = w.chatMemUpto || 0;
  if (w.chat.length < w.chatMemUpto){ w.chatMemUpto = 0; w.chatMem = ""; }
  const end = w.chat.length - CHAT_KEEP;
  if (end - w.chatMemUpto < 8) return false;
  const A = AIS(), nm = (w.fields.name || w.name).trim();
  const chunk = w.chat.slice(w.chatMemUpto, end).map(m => (m.r === "user" ? A.userName : nm) + ": " + m.t).join("\n\n");
  const prompt = `아래는 롤플레이 대화의 지난 부분이야. 기존 요약에 새 내용을 합쳐서, 앞으로 이야기를 이어가는 데 꼭 필요한 사실만 한국어 불릿으로 정리해: 일어난 사건, 관계·감정 변화, 약속, 밝혀진 비밀, 소지품, 지금 장소와 상황. 700자 이내. 요약만 출력.

[기존 요약]
${w.chatMem || "(없음)"}

[새 대화]
${chunk}`;
  try { w.chatMem = (await aiChat([{ role:"user", content:prompt }], { maxTokens: 2500, temperature: 0.3 })).trim(); w.chatMemUpto = end; save(); return true; }
  catch(e){ return false; }
}
function fmtChat(t){
  const esc = t.replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c]));
  return esc.replace(/\*([^*\n]+)\*/g, '<i style="opacity:.72">$1</i>').replace(/\n/g, "<br>");
}
VIEWS.chat = (body) => {
  const w = W(), A = AIS();
  const nm = (w.fields.name || w.name).trim();
  const sub = s => (s || "").split("{{char}}").join(nm).split("{{user}}").join(A.userName);
  w.chat = w.chat || [];
  if (!w.chat.length && (w.fields.first || "").trim()) w.chat.push({ r:"assistant", t: sub(w.fields.first.trim()) });
  const list = h("div");
  const info = h("div", { class:"tiny", style:"margin:6px 2px" });
  const inp = h("textarea", { placeholder: aiOn() ? "메시지… (*행동* 도 돼요)" : "🧠 AI 엔진을 먼저 켜 주세요", style:"min-height:52px;flex:1" });
  let busy = false, ctrl = null;
  const bubble = m => h("div", { style:`margin:8px 0;display:flex;${m.r === "user" ? "justify-content:flex-end" : ""}` },
    h("div", { style:`max-width:86%;padding:10px 13px;border-radius:16px;font-size:14.5px;line-height:1.6;${m.r === "user" ? "background:var(--ac2);color:#fff;border-bottom-right-radius:5px" : "background:var(--card);border:1px solid var(--line);border-bottom-left-radius:5px"}`, html: fmtChat(m.t || "…") }));
  const altNav = m => (m.alts && m.alts.length > 1) ? h("div", { class:"row", style:"gap:6px;margin:-2px 0 6px 4px" },
    h("button", { class:"btn sm", onclick:() => { m.ai = (m.ai - 1 + m.alts.length) % m.alts.length; m.t = m.alts[m.ai]; save(); draw(); } }, "◀"),
    h("span", { class:"tiny" }, (m.ai + 1) + " / " + m.alts.length),
    h("button", { class:"btn sm", onclick:() => { m.ai = (m.ai + 1) % m.alts.length; m.t = m.alts[m.ai]; save(); draw(); } }, "▶")) : null;
  const draw = () => {
    const last = w.chat[w.chat.length - 1];
    list.replaceChildren(...(w.chat.length ? w.chat.map(bubble).concat(last && last.r === "assistant" && !busy ? [altNav(last)].filter(Boolean) : []) : [h("p", { class:"muted", style:"text-align:center" }, "시작 메시지가 비어 있어요. 플롯 작성기에서 쓰거나 바로 말을 걸어 보세요.")]));
    window.scrollTo(0, document.body.scrollHeight);
  };
  async function reply(prevAlts){
    if (!aiOn()){ toast("🧠 AI 엔진을 먼저 켜 주세요"); return; }
    busy = true; ctrl = new AbortController(); sendBtn.textContent = "⏹";
    const me = { r:"assistant", t:"" }; w.chat.push(me); draw();
    const el = list.lastChild.firstChild;
    el.innerHTML = "<i>…</i>";
    const hist = w.chat.slice(0, -1);
    if (hist.length - (w.chatMemUpto || 0) > CHAT_KEEP + 7){ el.innerHTML = "<i>🧠 지난 이야기 기억 정리 중…</i>"; w.chat.pop(); await chatRemember(w); w.chat.push(me); }
    const recent = hist.slice(-4).map(m => m.t).join("\n");
    const { sys, used } = chatSystem(w, recent);
    info.textContent = [used.length ? "📖 키워드북: " + used.join(", ") : "", (w.chatMem || "").trim() ? "🧠 장기기억 사용 중" : ""].filter(Boolean).join(" · ");
    const from = Math.max(w.chatMemUpto || 0, hist.length - 30);
    const msgs = [{ role:"system", content:sys }].concat(hist.slice(from).map(m => ({ role: m.r, content: m.t })));
    if (msgs.length > 1 && msgs[1].role === "assistant") msgs.splice(1, 0, { role:"user", content:"(대화 시작)" });
    let okDone = false;
    try {
      const run = A.chatQuality === "balanced" && A.engine === "cloud"
        ? aiQuality(msgs, { quality:"balanced", chat:true, signal: ctrl.signal, maxTokens: 3000, onDraft: t => { el.style.opacity = ".55"; el.innerHTML = fmtChat(t); }, onText: t => { el.style.opacity = "1"; me.t = t; el.innerHTML = fmtChat(t); } }, s => { if (!me.t) el.innerHTML = "<i>" + s + "</i>"; })
        : aiChat(msgs, { signal: ctrl.signal, maxTokens: 3000, onThink: () => { el.innerHTML = "<i>생각 중…</i>"; }, onText: t => { me.t = t; el.innerHTML = fmtChat(t); window.scrollTo(0, document.body.scrollHeight); } });
      me.t = (await run).trim(); okDone = true;
    } catch(e){
      if (e.name === "AbortError"){ if (!me.t) w.chat.pop(); else okDone = true; }
      else { w.chat.pop(); toast("⚠ " + e.message.slice(0, 60)); openSheet("AI 오류", [h("div", { class:"out" }, e.message)]); }
    }
    if (prevAlts && prevAlts.length){
      if (okDone && me.t){ me.alts = prevAlts.concat([me.t]); me.ai = me.alts.length - 1; }
      else if (w.chat[w.chat.length - 1] !== me){ w.chat.push({ r:"assistant", t: prevAlts[prevAlts.length - 1], alts: prevAlts.length > 1 ? prevAlts : undefined, ai: prevAlts.length - 1 }); }
    }
    busy = false; sendBtn.textContent = "보내기"; save(); draw();
  }
  const sendBtn = h("button", { class:"btn p", style:"align-self:stretch", onclick:() => {
    if (busy){ ctrl && ctrl.abort(); return; }
    const t = inp.value.trim(); if (!t) return;
    w.chat.push({ r:"user", t }); inp.value = ""; save(); draw(); reply();
  } }, "보내기");
  body.append(
    h("div", { class:"card", style:"padding:10px 14px" }, h("div", { class:"row" }, h("div", { class:"grow" }, h("b", null, nm), h("div", { class:"tiny" }, "⚡ " + aiLabel() + " · 키워드북 " + w.lore.filter(x => x.on).length + "개 · 상태창 " + (w.status.items.length ? "켜짐" : "없음") + ((w.chatMem || "").trim() ? " · 🧠 기억 있음" : ""))),
      h("button", { class:"btn sm", onclick:() => { if (busy) return; const last = w.chat[w.chat.length - 1]; if (last && last.r === "assistant" && w.chat.length > 1){ const prev = (last.alts && last.alts.length ? last.alts : [last.t]).slice(-9); w.chat.pop(); save(); draw(); reply(prev); } else toast("다시 쓸 답이 없어요"); } }, "🔄 다른 답"),
      h("button", { class:"btn sm", onclick:() => { if (busy) return; w.chat.pop(); save(); draw(); } }, "↩"),
      h("button", { class:"btn sm", onclick:() => openSheet("🧠 장기기억", [h("div", { class:"out" }, (w.chatMem || "").trim() || "아직 없어요. 대화가 길어지면 자동으로 지난 이야기를 요약해서 기억해요."), h("div", { class:"tiny", style:"margin-top:6px" }, `최근 ${CHAT_KEEP}개 메시지는 그대로, 그 앞은 요약으로 기억해요.`)]) }, "🧠"),
      h("button", { class:"btn sm d", onclick:() => confirmSheet("대화를 처음부터 다시 할까요?", "새 대화", () => { w.chat = []; w.chatMem = ""; w.chatMemUpto = 0; save(); renderApp("chat"); }) }, "🗑"))),
    list, info,
    h("div", { style:"position:sticky;bottom:0;background:var(--bg);padding:8px 0 calc(var(--safe-b) + 8px);display:flex;gap:8px" }, inp, sendBtn)
  );
  draw();
};
