"use strict";
/* =====================================================================
   GIF 공방 — 자체 GIF 엔진
   외부 라이브러리 없이 직접 구현:
   · 미디언 컷 색 양자화 (32768칸 히스토그램)
   · 디더링: 바이어(4x4) / 플로이드-스타인버그
   · LZW 압축 + GIF89a 기록 (반복, 지연, 투명, 처리방식)
   · 변화 영역만 저장하는 프레임 최적화
   · GIF 디코더 (인터레이스, 처리방식 2/3 지원)
   ===================================================================== */

/* ---------------- 엔진: 필터 ---------------- */
function gifFilter(d, name){
  if (!name || name === "none") return;
  for (let i = 0, n = d.length; i < n; i += 4){
    let r = d[i], g = d[i+1], b = d[i+2], l;
    switch (name){
      case "gray": l = .299*r + .587*g + .114*b; r = g = b = l; break;
      case "noir": l = .299*r + .587*g + .114*b; r = g = b = (l-128)*1.6 + 128; break;
      case "sepia": { const nr=.393*r+.769*g+.189*b, ng=.349*r+.686*g+.168*b, nb=.272*r+.534*g+.131*b; r=nr; g=ng; b=nb; break; }
      case "vintage": { const nr=.393*r+.769*g+.189*b, ng=.349*r+.686*g+.168*b, nb=.272*r+.534*g+.131*b; r=(r*.45+nr*.55)*.95+12; g=(g*.45+ng*.55)*.92+8; b=(b*.45+nb*.55)*.85+10; break; }
      case "invert": r = 255-r; g = 255-g; b = 255-b; break;
      case "bright": r *= 1.18; g *= 1.18; b *= 1.18; break;
      case "contrast": r = (r-128)*1.35+128; g = (g-128)*1.35+128; b = (b-128)*1.35+128; break;
      case "warm": r += 22; g += 6; b -= 18; break;
      case "cool": r -= 16; g += 2; b += 24; break;
      case "pastel": r = r*.72+70; g = g*.72+70; b = b*.72+70; break;
      case "comic": r = Math.round(r/64)*64; g = Math.round(g/64)*64; b = Math.round(b/64)*64; break;
    }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i+1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i+2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

/* ---------------- 엔진: 미디언 컷 팔레트 ---------------- */
function buildPalette(datas, maxColors, skipAlpha){
  const cnt = new Uint32Array(32768), sum = new Float64Array(32768*3);
  let total = 0; for (const d of datas) total += d.length >> 2;
  const step = Math.max(1, Math.floor(total / 700000));
  for (const d of datas){
    for (let p = 0, n = d.length >> 2; p < n; p += step){
      const i = p << 2;
      if (skipAlpha && d[i+3] < 128) continue;
      const r = d[i], g = d[i+1], b = d[i+2], k = ((r>>3)<<10) | ((g>>3)<<5) | (b>>3);
      cnt[k]++; sum[k*3] += r; sum[k*3+1] += g; sum[k*3+2] += b;
    }
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) keys.push(k);
  if (!keys.length) return new Uint8Array([0,0,0]);
  const avg = ks => {
    let c = 0, r = 0, g = 0, b = 0;
    for (const k of ks){ c += cnt[k]; r += sum[k*3]; g += sum[k*3+1]; b += sum[k*3+2]; }
    return [Math.round(r/c), Math.round(g/c), Math.round(b/c)];
  };
  if (keys.length <= maxColors){
    const pal = new Uint8Array(keys.length*3);
    keys.forEach((k, j) => pal.set(avg([k]), j*3));
    return pal;
  }
  const mk = ks => {
    let c = 0, r0=31,g0=31,b0=31,r1=0,g1=0,b1=0;
    for (const k of ks){
      c += cnt[k];
      const r = (k>>10)&31, g = (k>>5)&31, b = k&31;
      if (r<r0) r0=r; if (r>r1) r1=r; if (g<g0) g0=g; if (g>g1) g1=g; if (b<b0) b0=b; if (b>b1) b1=b;
    }
    const rr = r1-r0, gr = g1-g0, br = b1-b0;
    const ax = rr >= gr && rr >= br ? 0 : gr >= br ? 1 : 2;
    return { ks, c, ax, range: [rr, gr, br][ax] };
  };
  const boxes = [mk(keys)];
  while (boxes.length < maxColors){
    let bi = -1, bs = 0;
    for (let i = 0; i < boxes.length; i++){
      const b = boxes[i];
      if (b.ks.length < 2 || b.range === 0) continue;
      const s = b.range * Math.sqrt(b.c);
      if (s > bs){ bs = s; bi = i; }
    }
    if (bi < 0) break;
    const b = boxes[bi], sh = b.ax === 0 ? 10 : b.ax === 1 ? 5 : 0;
    b.ks.sort((x, y) => ((x>>sh)&31) - ((y>>sh)&31));
    const half = b.c / 2; let acc = 0, cut = 1;
    for (let i = 0; i < b.ks.length - 1; i++){ acc += cnt[b.ks[i]]; cut = i + 1; if (acc >= half) break; }
    boxes.splice(bi, 1, mk(b.ks.slice(0, cut)), mk(b.ks.slice(cut)));
  }
  const pal = new Uint8Array(boxes.length*3);
  boxes.forEach((b, j) => pal.set(avg(b.ks), j*3));
  return pal;
}

/* ---------------- 엔진: 가장 가까운 색 (캐시) ---------------- */
function makeNearest(pal){
  const n = pal.length / 3, lut = new Int16Array(32768).fill(-1);
  return function(k){
    const v = lut[k]; if (v >= 0) return v;
    const r = ((k>>10)&31)*8+4, g = ((k>>5)&31)*8+4, b = (k&31)*8+4;
    let best = 0, bd = 1e12;
    for (let j = 0; j < n; j++){
      const dr = r-pal[j*3], dg = g-pal[j*3+1], db = b-pal[j*3+2];
      const d = dr*dr*2 + dg*dg*4 + db*db*3;
      if (d < bd){ bd = d; best = j; }
    }
    lut[k] = best; return best;
  };
}

/* ---------------- 엔진: 색 번호 매기기 + 디더링 ---------------- */
function indexFrame(d, w, h, pal, near, mode, spread, transIdx, transBg){
  const out = new Uint8Array(w*h);
  const B = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
  let cur = mode === 2 ? new Float32Array((w+2)*3) : null, nxt = mode === 2 ? new Float32Array((w+2)*3) : null;
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++){
      const p = y*w + x, i = p*4;
      if (transBg && d[i+3] < 128){ out[p] = transIdx; continue; }
      let r = d[i], g = d[i+1], b = d[i+2];
      if (mode === 1){ const t = (B[(y&3)*4 + (x&3)]/16 - 0.47) * spread; r += t; g += t; b += t; }
      else if (mode === 2){ const e = (x+1)*3; r += cur[e]; g += cur[e+1]; b += cur[e+2]; }
      r = r < 0 ? 0 : r > 255 ? 255 : r|0;
      g = g < 0 ? 0 : g > 255 ? 255 : g|0;
      b = b < 0 ? 0 : b > 255 ? 255 : b|0;
      const c = near(((r>>3)<<10) | ((g>>3)<<5) | (b>>3));
      out[p] = c;
      if (mode === 2){
        const er = (r-pal[c*3])*.9, eg = (g-pal[c*3+1])*.9, eb = (b-pal[c*3+2])*.9, e = (x+1)*3;
        cur[e+3] += er*7/16; cur[e+4] += eg*7/16; cur[e+5] += eb*7/16;
        nxt[e-3] += er*3/16; nxt[e-2] += eg*3/16; nxt[e-1] += eb*3/16;
        nxt[e]   += er*5/16; nxt[e+1] += eg*5/16; nxt[e+2] += eb*5/16;
        nxt[e+3] += er/16;   nxt[e+4] += eg/16;   nxt[e+5] += eb/16;
      }
    }
    if (mode === 2){ const t = cur; cur = nxt; nxt = t; nxt.fill(0); }
  }
  return out;
}

/* ---------------- 엔진: LZW 압축 ---------------- */
function lzwEncode(idx, minCode, o){
  if (!lzwEncode.codes){ lzwEncode.codes = new Uint16Array(1<<20); lzwEncode.stamp = new Uint32Array(1<<20); lzwEncode.gen = 0; }
  const codes = lzwEncode.codes, stamp = lzwEncode.stamp;
  let gen = ++lzwEncode.gen;
  o.byte(minCode);
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  const blk = new Uint8Array(256); let bl = 0, cur = 0, bits = 0;
  const put = v => { blk[++bl] = v; if (bl === 255){ blk[0] = 255; o.bytes(blk, 256); bl = 0; } };
  const emit = code => { cur |= code << bits; bits += size; while (bits >= 8){ put(cur & 255); cur >>>= 8; bits -= 8; } };
  emit(clear);
  let prefix = idx[0];
  for (let i = 1, n = idx.length; i < n; i++){
    const k = idx[i], key = (prefix << 8) | k;
    if (stamp[key] === gen){ prefix = codes[key]; continue; }
    emit(prefix);
    if (next === 4096){ emit(clear); next = eoi + 1; size = minCode + 1; gen = ++lzwEncode.gen; }
    else { if (next >= (1 << size)) size++; codes[key] = next++; stamp[key] = gen; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) put(cur & 255);
  if (bl > 0){ blk[0] = bl; o.bytes(blk, bl + 1); }
  o.byte(0);
}

class ByteOut {
  constructor(){ this.buf = new Uint8Array(1 << 20); this.n = 0; }
  need(k){ if (this.n + k > this.buf.length){ const nb = new Uint8Array(Math.max(this.buf.length*2, this.n + k)); nb.set(this.buf.subarray(0, this.n)); this.buf = nb; } }
  byte(v){ this.need(1); this.buf[this.n++] = v; }
  bytes(a, len){ this.need(len); this.buf.set(a.subarray(0, len), this.n); this.n += len; }
  u16(v){ this.byte(v & 255); this.byte((v >> 8) & 255); }
  str(s){ for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result(){ return this.buf.slice(0, this.n); }
}

/* ---------------- 엔진: GIF 인코더 본체 ---------------- */
function encodeGIF(job, progress){
  const w = job.w, h = job.h, n = job.frames.length;
  const datas = job.frames.map(b => new Uint8ClampedArray(b));
  for (let i = 0; i < n; i++) gifFilter(datas[i], job.filter);
  progress(0.04);
  const transBg = !!job.transparent, opt = !!job.optimize && !transBg, needT = transBg || opt;
  const pal = buildPalette(datas, Math.max(2, job.colors - (needT ? 1 : 0)), transBg);
  const pc = pal.length / 3, tIdx = needT ? pc : 0;
  let bits = 1; while ((1 << bits) < pc + (needT ? 1 : 0)) bits++;
  const near = makeNearest(pal);
  const mode = job.dither === "fs" ? 2 : job.dither === "bayer" ? 1 : 0;
  const spread = 255 / Math.cbrt(Math.max(2, pc)) * 0.9;
  progress(0.1);
  const recs = []; let prev = null;
  for (let f = 0; f < n; f++){
    const idx = indexFrame(datas[f], w, h, pal, near, mode, spread, tIdx, transBg);
    const delay = job.delays[f];
    if (opt && prev){
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++){
        const row = y*w;
        for (let x = 0; x < w; x++) if (idx[row+x] !== prev[row+x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
      }
      if (x1 < 0) recs[recs.length-1].delay += delay;
      else {
        const bw = x1-x0+1, bh = y1-y0+1, sub = new Uint8Array(bw*bh);
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++){ const p = (y+y0)*w + x + x0; sub[y*bw+x] = idx[p] === prev[p] ? tIdx : idx[p]; }
        recs.push({ x:x0, y:y0, w:bw, h:bh, idx:sub, delay, t:true });
      }
    } else recs.push({ x:0, y:0, w, h, idx, delay, t:transBg });
    prev = idx; datas[f] = null;
    progress(0.1 + 0.7*(f+1)/n);
  }
  const o = new ByteOut();
  o.str("GIF89a"); o.u16(w); o.u16(h);
  o.byte(0x80 | (7 << 4) | (bits - 1)); o.byte(0); o.byte(0);
  for (let j = 0; j < (1 << bits); j++){
    if (j < pc){ o.byte(pal[j*3]); o.byte(pal[j*3+1]); o.byte(pal[j*3+2]); } else { o.byte(0); o.byte(0); o.byte(0); }
  }
  if (job.loop !== 1){ o.byte(0x21); o.byte(0xFF); o.byte(11); o.str("NETSCAPE2.0"); o.byte(3); o.byte(1); o.u16(job.loop === 0 ? 0 : job.loop - 1); o.byte(0); }
  const disp = transBg ? 2 : 1, minCode = Math.max(2, bits);
  for (let i = 0; i < recs.length; i++){
    const r = recs[i];
    o.byte(0x21); o.byte(0xF9); o.byte(4);
    o.byte((disp << 2) | (r.t ? 1 : 0));
    o.u16(Math.min(65535, Math.max(2, Math.round(r.delay / 10))));
    o.byte(r.t ? tIdx : 0); o.byte(0);
    o.byte(0x2C); o.u16(r.x); o.u16(r.y); o.u16(r.w); o.u16(r.h); o.byte(0);
    lzwEncode(r.idx, minCode, o);
    progress(0.8 + 0.2*(i+1)/recs.length);
  }
  o.byte(0x3B);
  return o.result();
}

/* 작업자(Worker)에서 돌릴 엔진 소스 — 위 함수들을 그대로 옮겨 실행 */
const GIF_ENGINE_SRC =
  [gifFilter, buildPalette, makeNearest, indexFrame, lzwEncode, encodeGIF].map(f => f.toString()).join("\n") + "\n" +
  ByteOut.toString() + "\n" +
  "self.onmessage=function(e){try{var r=encodeGIF(e.data,function(p){self.postMessage({p:p});});self.postMessage({done:r},[r.buffer]);}catch(err){self.postMessage({err:String(err&&err.message||err)});}};";

function runEncode(job, onProg){
  return new Promise((res, rej) => {
    const mainThread = () => setTimeout(() => { try { res(encodeGIF(job, onProg)); } catch(e){ rej(e); } }, 30);
    let wk = null;
    try { wk = new Worker(URL.createObjectURL(new Blob([GIF_ENGINE_SRC], { type: "text/javascript" }))); } catch(e){ wk = null; }
    if (!wk) return mainThread();
    let ok = false;
    wk.onmessage = e => {
      const m = e.data; ok = true;
      if (m.p != null) onProg(m.p);
      else if (m.done){ wk.terminate(); res(m.done); }
      else if (m.err){ wk.terminate(); rej(new Error(m.err)); }
    };
    wk.onerror = () => { wk.terminate(); if (!ok) mainThread(); else rej(new Error("엔진 오류")); };
    wk.postMessage(job);
  });
}

/* ---------------- 엔진: GIF 디코더 ---------------- */
function lzwDecode(minCode, data, count){
  const out = new Uint8Array(count);
  const clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1, old = -1, first = 0;
  let datum = 0, bits = 0, op = 0;
  for (let i = 0; i < data.length && op < count; i++){
    datum |= data[i] << bits; bits += 8;
    while (bits >= size && op < count){
      let code = datum & mask; datum >>>= size; bits -= size;
      if (code === clear){ size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
      if (code === eoi) return out;
      if (old === -1){ out[op++] = suffix[code]; old = first = code; continue; }
      const inCode = code; let sp = 0;
      if (code >= next){ stack[sp++] = first; code = old; }
      while (code >= clear){ stack[sp++] = suffix[code]; code = prefix[code]; }
      first = suffix[code]; stack[sp++] = first;
      if (next < 4096){ prefix[next] = old; suffix[next] = first; next++; if (next === (1 << size) && size < 12){ size++; mask = (1 << size) - 1; } }
      old = inCode;
      while (sp > 0 && op < count) out[op++] = stack[--sp];
    }
  }
  return out;
}
function decodeGIF(buf){
  const b = new Uint8Array(buf); let p = 0;
  const u16 = () => { const v = b[p] | (b[p+1] << 8); p += 2; return v; };
  if (String.fromCharCode(b[0],b[1],b[2],b[3]) !== "GIF8") throw new Error("GIF 파일이 아니에요");
  p = 6;
  const W = u16(), H = u16(), pk = b[p++]; p += 2;
  let gct = null;
  if (pk & 0x80){ const n = 1 << ((pk & 7) + 1); gct = b.subarray(p, p + n*3); p += n*3; }
  const screen = new Uint8ClampedArray(W*H*4);
  const frames = [];
  let gce = { disp:0, delay:100, t:-1 }, prevDisp = 0, prevRect = null, saved = null;
  while (p < b.length){
    const s = b[p++];
    if (s === 0x3B) break;
    if (s === 0x21){
      const label = b[p++];
      if (label === 0xF9){ p++; const f = b[p++]; const d = u16(); const t = b[p++]; p++; gce = { disp:(f>>2)&7, delay: d < 2 ? 100 : d*10, t: (f & 1) ? t : -1 }; }
      else { while (p < b.length && b[p]) p += b[p] + 1; p++; }
      continue;
    }
    if (s !== 0x2C) break;
    const x = u16(), y = u16(), w = u16(), h = u16(), f = b[p++];
    let ct = gct;
    if (f & 0x80){ const n = 1 << ((f & 7) + 1); ct = b.subarray(p, p + n*3); p += n*3; }
    const inter = !!(f & 0x40), mc = b[p++];
    let len = 0, q = p; while (q < b.length && b[q]){ len += b[q]; q += b[q] + 1; }
    const data = new Uint8Array(len); let o = 0;
    while (p < b.length && b[p]){ const n = b[p++]; data.set(b.subarray(p, p + n), o); o += n; p += n; }
    p++;
    const idx = lzwDecode(mc, data, w*h);
    if (prevDisp === 2 && prevRect){
      for (let yy = prevRect.y; yy < Math.min(H, prevRect.y + prevRect.h); yy++) screen.fill(0, (yy*W + prevRect.x)*4, (yy*W + Math.min(W, prevRect.x + prevRect.w))*4);
    } else if (prevDisp === 3 && saved) screen.set(saved);
    saved = gce.disp === 3 ? screen.slice() : null;
    let rows = null;
    if (inter){ rows = []; for (const [st, sp] of [[0,8],[4,8],[2,4],[1,2]]) for (let r = st; r < h; r += sp) rows.push(r); }
    if (ct) for (let r = 0; r < h; r++){
      const yy = y + (rows ? rows[r] : r); if (yy >= H) continue;
      for (let c = 0; c < w; c++){
        const xx = x + c; if (xx >= W) continue;
        const ci = idx[r*w + c]; if (ci === gce.t) continue;
        const di = (yy*W + xx)*4;
        screen[di] = ct[ci*3]; screen[di+1] = ct[ci*3+1]; screen[di+2] = ct[ci*3+2]; screen[di+3] = 255;
      }
    }
    const cv = mkCanvas(W, H);
    cv.getContext("2d").putImageData(new ImageData(screen.slice(), W, H), 0, 0);
    frames.push({ c: cv, d: gce.delay });
    prevDisp = gce.disp; prevRect = { x, y, w, h };
    gce = { disp:0, delay:100, t:-1 };
  }
  return { w: W, h: H, frames };
}

/* =====================================================================
   GIF 공방 화면
   ===================================================================== */
(function injectCss(){
  const css = `
  .thumbs{display:flex;gap:6px;overflow-x:auto;padding:4px 2px 8px}
  .thumbs .th{flex:none;position:relative;border:2px solid transparent;border-radius:9px;overflow:hidden;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/12px 12px;padding:0}
  .thumbs .th.on{border-color:var(--ac)}
  .thumbs .th canvas{display:block;height:64px;width:auto}
  .thumbs .th span{position:absolute;left:3px;bottom:2px;font-size:10px;background:rgba(0,0,0,.6);color:#fff;border-radius:5px;padding:0 4px}
  .pvwrap{display:flex;justify-content:center;background:repeating-conic-gradient(#2a2633 0 25%,#1f1c27 0 50%) 0 0/16px 16px;border-radius:12px;padding:10px}
  .pvwrap canvas,.pvwrap img{max-width:100%;max-height:60vh;display:block;border-radius:6px}
  .stage{position:relative;width:100%;background:#fff;border-radius:12px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
  .stage canvas{position:absolute;inset:0;width:100%;height:100%}
  .stage .onion{opacity:.28;pointer-events:none}
  .sw{width:28px;height:28px;border-radius:50%;border:2px solid var(--line);padding:0}
  .sw.on{border-color:#fff;box-shadow:0 0 0 2px var(--ac)}
  details.card summary{font-weight:700;cursor:pointer;list-style:none}
  details.card summary::-webkit-details-marker{display:none}
  details.card summary:after{content:" ▾";color:var(--tx3)}
  .filebtn{position:relative;overflow:hidden;display:inline-block}
  .filebtn input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
  .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 8px}
  input[type=range]{width:100%;accent-color:var(--ac)}
  input[type=color]{width:100%;height:40px;border:1px solid var(--line);border-radius:11px;background:var(--bg2);padding:3px}
  .vid{width:100%;max-height:260px;border-radius:12px;background:#000}
  .engine{font-size:11.5px;color:var(--tx3);text-align:center;margin-top:10px;line-height:1.6}
  `;
  document.head.appendChild(h("style", null, css));
})();

const G = { frames: [], sel: 0, result: null, resultUrl: null };
function srcOpts(key, d){ S.gifSrc = S.gifSrc || {}; const o = S.gifSrc[key] = (S.gifSrc[key] && typeof S.gifSrc[key] === "object") ? S.gifSrc[key] : {}; for (const k in d) if (!(k in o)) o[k] = d[k]; return o; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mkCanvas(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
const dimOf = s => [s.naturalWidth || s.videoWidth || s.width, s.naturalHeight || s.videoHeight || s.height];
function toCanvas(src, maxDim){
  const [w, h] = dimOf(src), k = Math.min(1, maxDim / Math.max(w, h));
  const cv = mkCanvas(Math.max(1, Math.round(w*k)), Math.max(1, Math.round(h*k)));
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
function fitDraw(ctx, src, W, H, mode, scale, dx, dy){
  const [w, h] = dimOf(src);
  const k = (mode === "contain" ? Math.min(W/w, H/h) : Math.max(W/w, H/h)) * (scale || 1);
  const dw = w*k, dh = h*k;
  ctx.drawImage(src, (W-dw)/2 + (dx||0), (H-dh)/2 + (dy||0), dw, dh);
}
async function loadImg(file){
  if (window.createImageBitmap){ try { return await createImageBitmap(file); } catch(e){} }
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("이미지를 못 읽었어요: " + file.name)); im.src = URL.createObjectURL(file); });
}
function rnd(seed){ let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function filePick(label, accept, multiple, onFiles, cls){
  const inp = h("input", { type:"file", accept, multiple: multiple || null });
  inp.addEventListener("change", () => { const fs = [...inp.files]; inp.value = ""; if (fs.length) onFiles(fs); });
  return h("label", { class: "btn filebtn " + (cls || "p") }, label, inp);
}
function sel(opts, val, on, style){
  return h("select", { style: style || "", onchange: e => on(e.target.value) }, opts.map(([v, t]) => h("option", { value: v, selected: String(v) === String(val) || null }, t)));
}
function lab(t, el){ return h("div", null, h("label", { class:"f" }, t), el); }
function star4(ctx, x, y, r){
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r); ctx.fill();
}
const beat = t => Math.exp(-Math.pow((t - .12) / .05, 2)) + .7 * Math.exp(-Math.pow((t - .32) / .05, 2));

/* ---------- 출력 설정 ---------- */
function GO(){
  const d = ({ width:360, ratio:"auto", fit:"cover", bg:"#ffffff", transparent:false, dir:"fwd", loop:0, filter:"none",
    cap:"", capPos:"bottom", capSize:10, capColor:"#ffffff", capStroke:"#000000", capFont:"Black Han Sans",
    colors:256, dither:"bayer", optimize:true });
  if (!S.gifOpts || typeof S.gifOpts !== "object") S.gifOpts = {};
  for (const k in d) if (!(k in S.gifOpts)) S.gifOpts[k] = d[k];
  return S.gifOpts;
}
function outSize(o){
  let rw, rh;
  if (o.ratio === "auto" && G.frames[0]){ rw = G.frames[0].c.width; rh = G.frames[0].c.height; }
  else if (o.ratio === "auto"){ rw = rh = 1; }
  else [rw, rh] = o.ratio.split(":").map(Number);
  const W = Math.max(16, Math.round(+o.width));
  return { W, H: Math.max(16, Math.min(2000, Math.round(W * rh / rw))) };
}
function seqOf(o){
  const n = G.frames.length, a = [...Array(n).keys()];
  if (o.dir === "rev") return a.reverse();
  if (o.dir === "ping") return n > 2 ? a.concat(a.slice(1, -1).reverse()) : a;
  return a;
}
function drawCaption(ctx, W, H, o, text){
  if (!text || !text.trim()) return;
  const fs = Math.max(8, Math.round(W * o.capSize / 100));
  ctx.save();
  ctx.font = `${fs}px "${o.capFont}", "IBM Plex Sans KR", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const lines = text.split("\n"), lh = fs * 1.18, tot = lines.length * lh, pad = H * .05;
  let y = o.capPos === "top" ? pad + lh/2 : o.capPos === "middle" ? H/2 - tot/2 + lh/2 : H - pad - tot + lh/2;
  for (const ln of lines){
    if (o.capStroke && o.capStroke !== "none"){ ctx.lineWidth = Math.max(2, fs * .17); ctx.strokeStyle = o.capStroke; ctx.strokeText(ln, W/2, y, W*.94); }
    ctx.fillStyle = o.capColor; ctx.fillText(ln, W/2, y, W*.94);
    y += lh;
  }
  ctx.restore();
}
function compose(fr, ctx, W, H, o){
  ctx.clearRect(0, 0, W, H);
  if (!o.transparent){ ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H); }
  fitDraw(ctx, fr.c, W, H, o.fit);
  drawCaption(ctx, W, H, o, fr.cap != null && fr.cap !== "" ? fr.cap : o.cap);
}

/* ---------- 프레임 넣기 ---------- */
let gifRerender = () => {};
function addFrames(list, after){
  if (!list.length) return toast("만들어진 프레임이 없어요");
  const apply = (append) => {
    if (append) G.frames = G.frames.concat(list);
    else { G.frames = list; GO().ratio = "auto"; }
    G.sel = append ? G.frames.length - list.length : 0;
    clearResult(); save();
    after && after();
    gifRerender();
    toast(list.length + "프레임 준비 완료");
    setTimeout(() => { const ed = document.getElementById("gifEditor"); ed && ed.scrollIntoView({ behavior:"smooth", block:"start" }); }, 80);
  };
  if (!G.frames.length) return apply(false);
  openSheet("이미 " + G.frames.length + "프레임이 있어요", [
    h("button", { class:"btn p", style:"width:100%;margin-bottom:6px", onclick:() => { closeSheet(); apply(false); } }, "새로 시작 (기존 지우기)"),
    h("button", { class:"btn", style:"width:100%", onclick:() => { closeSheet(); apply(true); } }, "뒤에 이어 붙이기")
  ]);
}
function clearResult(){ if (G.resultUrl) URL.revokeObjectURL(G.resultUrl); G.result = null; G.resultUrl = null; }

/* ================= 소스 1: 사진 ================= */
function srcPhoto(box){
  const P = S.gifSrc.photo = srcOpts("photo", { ms:500, fade:false }, S.gifSrc.photo);
  const status = h("div", { class:"tiny", style:"margin-top:8px" });
  box.append(
    h("div", { class:"muted" }, "사진 여러 장을 고르면 순서대로 넘어가는 GIF가 돼요."),
    h("div", { class:"g2" },
      lab("한 장당 시간 (ms)", h("input", { type:"number", value:P.ms, min:20, step:50, oninput:e => { P.ms = +e.target.value || 500; save(); } })),
      lab("전환", sel([["0","바로 넘김"],["1","부드럽게 (크로스페이드)"]], P.fade ? "1" : "0", v => { P.fade = v === "1"; save(); }))),
    h("div", { class:"btns" }, filePick("📷 사진 고르기", "image/*", true, async files => {
      status.textContent = "불러오는 중…";
      try {
        files.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric:true }));
        const imgs = [];
        for (const f of files) imgs.push(await loadImg(f));
        let cvs = imgs.map(im => toCanvas(im, 720));
        const list = [];
        if (P.fade && cvs.length > 1){
          const W0 = cvs[0].width, H0 = cvs[0].height;
          cvs = cvs.map(c => { const n = mkCanvas(W0, H0); fitDraw(n.getContext("2d"), c, W0, H0, "cover"); return n; });
          cvs.forEach((c, i) => {
            list.push({ c, d: P.ms });
            const nx = cvs[(i + 1) % cvs.length];
            for (let k = 1; k <= 5; k++){
              const m = mkCanvas(W0, H0), x = m.getContext("2d");
              x.drawImage(c, 0, 0); x.globalAlpha = k / 6; x.drawImage(nx, 0, 0);
              list.push({ c: m, d: 60 });
            }
          });
        } else cvs.forEach(c => list.push({ c, d: P.ms }));
        status.textContent = "";
        addFrames(list);
      } catch(e){ status.textContent = "⚠ " + e.message; }
    })),
    status
  );
}

/* ================= 소스 2: 영상 ================= */
function srcVideo(box){
  const P = S.gifSrc.video = srcOpts("video", { start:0, len:3, fps:10, max:400 }, S.gifSrc.video);
  const vid = h("video", { class:"vid hidden", controls:true, playsinline:true, muted:true, preload:"auto" });
  vid.muted = true; vid.setAttribute("webkit-playsinline", "");
  const startIn = h("input", { type:"range", min:0, max:1, step:0.05, value:0 });
  const startLbl = h("span", { class:"tiny" }, "0.0초");
  const status = h("div", { class:"tiny", style:"margin-top:8px" });
  const ctl = h("div", { class:"hidden" },
    h("label", { class:"f" }, "시작 위치 ", startLbl), startIn,
    h("div", { class:"btns" }, h("button", { class:"btn sm", onclick:() => { startIn.value = vid.currentTime; startIn.oninput(); } }, "⏱ 지금 위치를 시작으로")),
    h("div", { class:"g3" },
      lab("길이 (초)", h("input", { type:"number", min:0.5, max:15, step:0.5, value:P.len, oninput:e => { P.len = Math.min(15, +e.target.value || 3); save(); } })),
      lab("초당 프레임", sel([[5,"5"],[8,"8"],[10,"10"],[12,"12"],[15,"15"],[20,"20"]], P.fps, v => { P.fps = +v; save(); })),
      lab("크기 (긴 쪽)", sel([[240,"240"],[320,"320"],[400,"400"],[480,"480"],[640,"640"]], P.max, v => { P.max = +v; save(); }))),
    h("div", { class:"btns" }, h("button", { class:"btn v", onclick: extract }, "🎞 프레임 뽑기")),
  );
  startIn.oninput = () => { startLbl.textContent = (+startIn.value).toFixed(1) + "초"; vid.currentTime = +startIn.value; };
  const seek = t => new Promise(res => {
    let tm; const done = () => { vid.removeEventListener("seeked", done); clearTimeout(tm); res(); };
    vid.addEventListener("seeked", done); tm = setTimeout(done, 3000); vid.currentTime = t;
  });
  async function extract(){
    if (!vid.duration) return toast("영상을 먼저 골라 주세요");
    // 아이폰은 한 번 재생해야 프레임을 그릴 수 있어서 잠깐 재생 후 멈춤
    try { vid.muted = true; await vid.play(); } catch(e){}
    vid.pause();
    if (vid.readyState < 2) await new Promise(r => { const t = setTimeout(r, 2500); vid.addEventListener("loadeddata", () => { clearTimeout(t); r(); }, { once:true }); });
    const st = +startIn.value, n = Math.max(1, Math.round(P.len * P.fps)), dt = 1 / P.fps, list = [];
    for (let i = 0; i < n; i++){
      const t = st + i*dt; if (t > vid.duration - 0.01) break;
      await seek(t);
      list.push({ c: toCanvas(vid, P.max), d: Math.round(1000 / P.fps) });
      status.textContent = `프레임 뽑는 중… ${i+1}/${n}`;
    }
    status.textContent = "";
    addFrames(list);
  }
  box.append(
    h("div", { class:"muted" }, "영상에서 원하는 구간을 잘라 GIF로 만들어요. (최대 15초)"),
    h("div", { class:"btns", style:"margin-bottom:8px" }, filePick("🎥 영상 고르기", "video/*", false, files => {
      if (G.videoUrl) URL.revokeObjectURL(G.videoUrl);
      G.videoUrl = URL.createObjectURL(files[0]);
      vid.src = G.videoUrl; vid.classList.remove("hidden");
      status.textContent = "영상 읽는 중…";
      vid.onloadedmetadata = () => { startIn.max = Math.max(0, vid.duration - 0.1); startIn.value = 0; startIn.oninput(); ctl.classList.remove("hidden"); status.textContent = `길이 ${vid.duration.toFixed(1)}초 · ${vid.videoWidth}×${vid.videoHeight}`; };
      vid.onerror = () => { status.textContent = "⚠ 이 영상 형식은 이 브라우저에서 못 열어요"; };
      vid.load();
    })),
    vid, ctl, status
  );
}

/* ================= 소스 3: GIF 열기 ================= */
function srcGifIn(box){
  const status = h("div", { class:"tiny", style:"margin-top:8px" });
  box.append(
    h("div", { class:"muted" }, "가지고 있는 GIF를 프레임으로 풀어서 자르고, 자막 달고, 속도 바꾸고, 거꾸로 돌릴 수 있어요."),
    h("div", { class:"btns" }, filePick("🎞 GIF 고르기", "image/gif", false, async files => {
      status.textContent = "푸는 중…";
      try {
        const r = decodeGIF(await files[0].arrayBuffer());
        status.textContent = `${r.w}×${r.h} · ${r.frames.length}프레임`;
        addFrames(r.frames);
      } catch(e){ status.textContent = "⚠ " + e.message; }
    })),
    status
  );
}

/* ================= 소스 4: 그리기 (플립북) ================= */
function srcDraw(box){
  const D = G.draw = G.draw || { ratio:"1:1", pages:null, cur:0, color:"#222222", size:6, tool:"pen", onion:true, fps:8 };
  const dims = r => { const [a, b] = r.split(":").map(Number); return a >= b ? [480, Math.round(480*b/a)] : [Math.round(480*a/b), 480]; };
  const newPage = () => { const [w, hh] = dims(D.ratio); return { c: mkCanvas(w, hh), u: [] }; };
  if (!D.pages) D.pages = [newPage()];
  const onion = h("canvas", { class:"onion" });
  const stage = h("div", { class:"stage" });
  const pageLbl = h("b");
  function show(){
    D.cur = Math.max(0, Math.min(D.cur, D.pages.length - 1));
    const pg = D.pages[D.cur];
    stage.style.aspectRatio = pg.c.width + "/" + pg.c.height;
    onion.width = pg.c.width; onion.height = pg.c.height;
    const ox = onion.getContext("2d"); ox.clearRect(0, 0, onion.width, onion.height);
    if (D.onion && D.cur > 0) ox.drawImage(D.pages[D.cur - 1].c, 0, 0);
    stage.replaceChildren(onion, pg.c);
    pageLbl.textContent = `${D.cur + 1} / ${D.pages.length}`;
  }
  const pos = e => { const r = stage.getBoundingClientRect(), c = D.pages[D.cur].c; return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
  const pushUndo = pg => { pg.u.push(pg.c.getContext("2d").getImageData(0, 0, pg.c.width, pg.c.height)); if (pg.u.length > 20) pg.u.shift(); };
  const ink = (ctx) => { ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = D.size; ctx.strokeStyle = ctx.fillStyle = D.color; ctx.globalCompositeOperation = D.tool === "eraser" ? "destination-out" : "source-over"; };
  let drawing = false, last = null;
  stage.addEventListener("pointerdown", e => {
    e.preventDefault();
    const pg = D.pages[D.cur], p = pos(e);
    pushUndo(pg);
    if (D.tool === "fill"){ floodFill(pg.c, Math.floor(p.x), Math.floor(p.y), D.color); return; }
    drawing = true; last = p;
    try { stage.setPointerCapture(e.pointerId); } catch(_){}
    const ctx = pg.c.getContext("2d"); ink(ctx);
    ctx.beginPath(); ctx.arc(p.x, p.y, D.size / 2, 0, Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  });
  stage.addEventListener("pointermove", e => {
    if (!drawing) return;
    const ctx = D.pages[D.cur].c.getContext("2d"); ink(ctx);
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])){ const p = pos(ev); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; }
    ctx.globalCompositeOperation = "source-over";
  });
  const up = () => { drawing = false; };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);

  const COLORS = ["#222222","#ffffff","#ff3b5c","#ff8a3d","#ffd43b","#3ddc97","#3a8bff","#8b5cf6","#ff7eb6","#8d6e63","#9ca3af","#f5d0a9"];
  const swBox = h("div", { class:"row", style:"gap:6px" });
  const drawSw = () => { swBox.replaceChildren(...COLORS.map(c => h("button", { class:"sw" + (D.color === c ? " on" : ""), style:"background:" + c, onclick:() => { D.color = c; if (D.tool === "eraser") D.tool = "pen"; drawSw(); drawTools(); } })),
    h("input", { type:"color", value:D.color, style:"width:40px;height:30px;padding:0", oninput:e => { D.color = e.target.value; drawSw(); } })); };
  const toolBox = h("div", { class:"row", style:"gap:4px" });
  const drawTools = () => { toolBox.replaceChildren(...[["pen","✏️ 펜"],["eraser","🧽 지우개"],["fill","🪣 채우기"]].map(([k, t]) => h("button", { class:"pill" + (D.tool === k ? " on" : ""), onclick:() => { D.tool = k; drawTools(); } }, t)),
    h("button", { class:"pill" + (D.onion ? " on" : ""), onclick:() => { D.onion = !D.onion; drawTools(); show(); } }, "🧅 어니언")); };
  box.append(
    h("div", { class:"muted" }, "한 장씩 그려서 넘기는 플립북이에요. 🧅 어니언을 켜면 앞 장이 흐리게 비쳐요."),
    h("div", { class:"row", style:"margin:8px 0" },
      sel([["1:1","1:1"],["3:5","3:5"],["9:16","9:16"],["4:3","4:3"],["16:9","16:9"]], D.ratio, v => {
        confirmSheet("비율을 바꾸면 그린 장이 모두 지워져요.", "바꾸기", () => { D.ratio = v; D.pages = [newPage()]; D.cur = 0; show(); });
      }, "width:auto"),
      h("div", { class:"grow" }, h("input", { type:"range", min:1, max:48, value:D.size, oninput:e => { D.size = +e.target.value; } }))),
    toolBox, h("div", { style:"margin:8px 0" }, swBox),
    stage,
    h("div", { class:"row", style:"margin-top:8px;justify-content:space-between" },
      h("div", { class:"row", style:"gap:4px" },
        h("button", { class:"btn sm", onclick:() => { D.cur--; show(); } }, "◀"), pageLbl,
        h("button", { class:"btn sm", onclick:() => { D.cur++; show(); } }, "▶")),
      h("div", { class:"row", style:"gap:4px" },
        h("button", { class:"btn sm", onclick:() => { const pg = D.pages[D.cur]; const u = pg.u.pop(); if (u) pg.c.getContext("2d").putImageData(u, 0, 0); else toast("되돌릴 게 없어요"); } }, "↶"),
        h("button", { class:"btn sm", onclick:() => { const pg = D.pages[D.cur]; pushUndo(pg); pg.c.getContext("2d").clearRect(0, 0, pg.c.width, pg.c.height); } }, "비우기"))),
    h("div", { class:"btns" },
      h("button", { class:"btn sm", onclick:() => { D.pages.splice(D.cur + 1, 0, newPage()); D.cur++; show(); } }, "＋ 빈 장"),
      h("button", { class:"btn sm", onclick:() => { const src = D.pages[D.cur].c, np = newPage(); np.c.getContext("2d").drawImage(src, 0, 0); D.pages.splice(D.cur + 1, 0, np); D.cur++; show(); } }, "⧉ 복제해서 다음 장"),
      h("button", { class:"btn sm d", onclick:() => { if (D.pages.length < 2){ const pg = D.pages[0]; pg.c.getContext("2d").clearRect(0, 0, pg.c.width, pg.c.height); return; } D.pages.splice(D.cur, 1); show(); } }, "🗑 장 삭제"),
      G.frames.length ? h("button", { class:"btn sm", onclick:() => {
        confirmSheet("편집기의 " + G.frames.length + "프레임을 그리기 장으로 가져올까요? (위에 덧그리기용)", "가져오기", () => {
          const [w, hh] = dims(D.ratio), o = GO();
          D.pages = G.frames.map(f => { const c = mkCanvas(w, hh); fitDraw(c.getContext("2d"), f.c, w, hh, o.fit); return { c, u: [] }; });
          D.cur = 0; show();
        });
      } }, "⬇ 편집기 프레임 가져오기") : null),
    h("div", { class:"row", style:"margin-top:8px" },
      h("span", { class:"tiny" }, "속도"), sel([[4,"초당 4장"],[6,"초당 6장"],[8,"초당 8장"],[12,"초당 12장"],[15,"초당 15장"]], D.fps, v => { D.fps = +v; }, "width:auto"),
      h("button", { class:"btn v grow", onclick:() => {
        addFrames(D.pages.map(pg => { const c = mkCanvas(pg.c.width, pg.c.height); c.getContext("2d").drawImage(pg.c, 0, 0); return { c, d: Math.round(1000 / D.fps) }; }));
      } }, "🎞 GIF 편집기로 보내기"))
  );
  drawSw(); drawTools(); show();
}
function floodFill(cv, x, y, hex){
  const ctx = cv.getContext("2d"), w = cv.width, hh = cv.height;
  if (x < 0 || y < 0 || x >= w || y >= hh) return;
  const im = ctx.getImageData(0, 0, w, hh), d = im.data;
  const fr = parseInt(hex.slice(1,3),16), fg = parseInt(hex.slice(3,5),16), fb = parseInt(hex.slice(5,7),16);
  const i0 = (y*w + x)*4, tr = d[i0], tg = d[i0+1], tb = d[i0+2], ta = d[i0+3];
  if (ta === 255 && tr === fr && tg === fg && tb === fb) return;
  const seen = new Uint8Array(w*hh), st = [x, y];
  while (st.length){
    const py = st.pop(), px = st.pop();
    if (px < 0 || py < 0 || px >= w || py >= hh) continue;
    const p = py*w + px; if (seen[p]) continue; seen[p] = 1;
    const i = p*4;
    if (Math.abs(d[i]-tr) + Math.abs(d[i+1]-tg) + Math.abs(d[i+2]-tb) + Math.abs(d[i+3]-ta) > 110) continue;
    d[i] = fr; d[i+1] = fg; d[i+2] = fb; d[i+3] = 255;
    st.push(px+1, py, px-1, py, px, py+1, px, py-1);
  }
  ctx.putImageData(im, 0, 0);
}

/* ================= 소스 5: 글자 GIF ================= */
const TEXT_FX = [["bounce","통통 튀기"],["type","타자기"],["zoom","쾅! 등장"],["shake","덜덜 흔들림"],["wave","물결"],["rainbow","무지개"],["neon","네온"],["blink","깜빡깜빡"],["heart","두근두근"],["slide","흘러가기"]];
const FONTS = [["Black Han Sans","검은고딕"],["Jua","주아"],["Do Hyeon","도현"],["Gaegu","개구"],["Nanum Pen Script","나눔펜"],["IBM Plex Sans KR","기본 고딕"]];
async function renderTextFrames(T){
  const [a, b] = T.ratio.split(":").map(Number);
  const W = a >= b ? 480 : Math.round(480*a/b), H = a >= b ? Math.round(480*b/a) : 480;
  const n = Math.max(2, Math.round(T.sec * T.fps));
  const fs = W * T.size / 100, font = `${fs}px "${T.font}", "IBM Plex Sans KR", sans-serif`;
  try { await document.fonts.load(font, T.text); } catch(e){}
  const lines = T.text.split("\n"), N = [...T.text.replace(/\n/g, "")].length || 1;
  const out = [], meas = mkCanvas(1, 1).getContext("2d"); meas.font = font;
  const lineW = lines.map(l => [...l].reduce((s, ch) => s + meas.measureText(ch).width, 0));
  const maxW = Math.max(1, ...lineW), lh = fs * 1.25;
  for (let f = 0; f < n; f++){
    const t = f / n, R = rnd(f + 7);
    const cv = mkCanvas(W, H), ctx = cv.getContext("2d");
    if (!T.transparent){ ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H); }
    ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    ctx.save();
    let gs = 1, gdx = 0, gdy = 0, grot = 0, galpha = 1;
    if (T.fx === "shake"){ gdx = (R()-.5)*fs*.16; gdy = (R()-.5)*fs*.16; grot = (R()-.5)*.08; }
    if (T.fx === "zoom"){ if (t < .2){ const k = 1 - Math.pow(1 - t/.2, 3); gs = 2.8 - 1.8*k; galpha = Math.min(1, t/.12); } else if (t < .4){ gdx = (R()-.5)*fs*.12; gdy = (R()-.5)*fs*.12; } }
    if (T.fx === "heart") gs = 1 + .16 * beat(t);
    if (T.fx === "blink") galpha = t < .6 ? 1 : 0;
    ctx.translate(W/2 + gdx, H/2 + gdy); ctx.rotate(grot); ctx.scale(gs, gs); ctx.translate(-W/2, -H/2);
    ctx.globalAlpha = galpha;
    const shown = T.fx === "type" ? Math.floor(Math.min(1, t / .75) * N + .0001) : N;
    let gi = 0;
    const y0 = H/2 - (lines.length - 1) * lh / 2;
    lines.forEach((ln, li) => {
      let x = T.fx === "slide" ? W - t * (W + maxW) + (maxW - lineW[li]) / 2 : (W - lineW[li]) / 2;
      const y = y0 + li * lh;
      for (const ch of ln){
        const cw = meas.measureText(ch).width;
        if (gi < shown){
          let dy = 0, col = T.color;
          if (T.fx === "bounce") dy = -Math.max(0, Math.sin(t*Math.PI*2 - gi*.45)) * fs * .35;
          if (T.fx === "wave") dy = Math.sin(t*Math.PI*2 + gi*.6) * fs * .18;
          if (T.fx === "rainbow") col = `hsl(${(gi*32 + t*360) % 360},95%,62%)`;
          if (T.fx === "neon"){ ctx.shadowColor = T.color; ctx.shadowBlur = fs * ((f % 7 === 3 || f % 11 === 5) ? .15 : .55); ctx.globalAlpha = galpha * ((f % 7 === 3) ? .45 : 1); }
          if (T.stroke){ ctx.lineWidth = fs * .16; ctx.strokeStyle = T.strokeColor; ctx.strokeText(ch, x + cw/2, y + dy); }
          ctx.fillStyle = col; ctx.fillText(ch, x + cw/2, y + dy);
        } else if (gi === shown && T.fx === "type" && (f % 4) < 2){
          ctx.fillStyle = T.color; ctx.fillRect(x + 2, y - fs*.45, fs*.08, fs*.9);
        }
        x += cw; gi++;
      }
    });
    ctx.restore();
    out.push({ c: cv, d: Math.round(1000 / T.fps) });
  }
  return out;
}
function srcText(box){
  const T = S.gifSrc.text = srcOpts("text", { text:"흑철기사단장\n성녀로 전직!", font:"Black Han Sans", fx:"bounce", size:14, color:"#ffffff", stroke:true, strokeColor:"#ff3d7f", bg:"#1a1024", transparent:false, ratio:"1:1", sec:2, fps:12 }, S.gifSrc.text);
  const sv = () => save();
  box.append(
    h("textarea", { value:T.text, style:"min-height:70px", oninput:e => { T.text = e.target.value; sv(); } }),
    h("div", { class:"g2" },
      lab("움직임", sel(TEXT_FX, T.fx, v => { T.fx = v; sv(); })),
      lab("글꼴", sel(FONTS, T.font, v => { T.font = v; sv(); }))),
    h("div", { class:"g3" },
      lab("글자색", h("input", { type:"color", value:T.color, oninput:e => { T.color = e.target.value; sv(); } })),
      lab("테두리색", h("input", { type:"color", value:T.strokeColor, oninput:e => { T.strokeColor = e.target.value; sv(); } })),
      lab("배경색", h("input", { type:"color", value:T.bg, oninput:e => { T.bg = e.target.value; sv(); } }))),
    h("div", { class:"g3" },
      lab("비율", sel([["1:1","1:1"],["3:5","3:5"],["9:16","9:16"],["16:9","16:9"],["3:1","3:1 배너"]], T.ratio, v => { T.ratio = v; sv(); })),
      lab("길이", sel([[1,"1초"],[1.5,"1.5초"],[2,"2초"],[3,"3초"],[4,"4초"]], T.sec, v => { T.sec = +v; sv(); })),
      lab("부드러움", sel([[8,"8fps"],[12,"12fps"],[15,"15fps"],[20,"20fps"]], T.fps, v => { T.fps = +v; sv(); }))),
    lab("글자 크기", h("input", { type:"range", min:5, max:30, value:T.size, oninput:e => { T.size = +e.target.value; sv(); } })),
    h("label", { class:"check", style:"border:0" }, h("input", { type:"checkbox", checked:T.stroke, onchange:e => { T.stroke = e.target.checked; sv(); } }), "테두리"),
    h("label", { class:"check", style:"border:0" }, h("input", { type:"checkbox", checked:T.transparent, onchange:e => { T.transparent = e.target.checked; sv(); } }), "배경 투명 (스티커용)"),
    h("div", { class:"btns" }, h("button", { class:"btn v", onclick: async () => {
      const fr = await renderTextFrames(T);
      addFrames(fr, () => { const o = GO(); o.transparent = T.transparent; o.fit = "contain"; o.optimize = !T.transparent; o.cap = ""; });
    } }, "🔤 글자 GIF 만들기"))
  );
}

/* ================= 소스 6: 세로 스크롤 GIF ================= */
function srcScroll(box){
  const P = S.gifSrc.scroll = srcOpts("scroll", { ratio:"3:5", width:360, speed:4, pause:1, fps:15 }, S.gifSrc.scroll);
  const status = h("div", { class:"tiny", style:"margin-top:8px" });
  const listBox = h("div", { class:"tiny" });
  const showList = () => { listBox.textContent = G.scrollImgs && G.scrollImgs.length ? `${G.scrollImgs.length}장 선택됨 (이름순으로 이어 붙임)` : ""; };
  async function build(){
    const imgs = G.scrollImgs || [];
    if (!imgs.length) return toast("이미지를 먼저 골라 주세요");
    const [a, b] = P.ratio.split(":").map(Number);
    const W = P.width, WH = Math.round(W * b / a);
    const items = []; let y = 0;
    for (const im of imgs){ const [iw, ih] = dimOf(im); const hh = ih * W / iw; items.push({ im, y, h: hh }); y += hh; }
    const total = y;
    let step = Math.max(1, Math.round(P.speed * 4 * W / 360));
    const span = Math.max(0, total - WH);
    if (span / step > 400){ step = Math.ceil(span / 400); toast("프레임이 너무 많아 속도를 올렸어요"); }
    const list = [], d = Math.round(1000 / P.fps);
    for (let pos = 0; ; pos += step){
      const py = Math.min(pos, span);
      const cv = mkCanvas(W, WH), ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, WH);
      for (const it of items) if (it.y < py + WH && it.y + it.h > py) ctx.drawImage(it.im, 0, it.y - py, W, it.h);
      list.push({ c: cv, d });
      status.textContent = `만드는 중… ${list.length}`;
      if (py >= span) break;
      if (list.length % 20 === 0) await sleep(0);
    }
    list[0].d += P.pause * 1000; list[list.length - 1].d += P.pause * 1000;
    status.textContent = "";
    addFrames(list, () => { const o = GO(); o.width = W; o.fit = "cover"; o.dir = "fwd"; });
  }
  box.append(
    h("div", { class:"muted" }, "긴 세로툰(또는 컷 여러 장)을 위에서 아래로 스르륵 내려가는 홍보용 GIF로 만들어요."),
    h("div", { class:"btns" }, filePick("📜 세로툰 이미지 고르기", "image/*", true, async files => {
      files.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric:true }));
      status.textContent = "불러오는 중…";
      G.scrollImgs = [];
      for (const f of files) G.scrollImgs.push(await loadImg(f));
      status.textContent = ""; showList();
    })),
    listBox,
    h("div", { class:"g3" },
      lab("창 비율", sel([["3:5","3:5"],["9:16","9:16"],["4:5","4:5"],["1:1","1:1"]], P.ratio, v => { P.ratio = v; save(); })),
      lab("가로 (px)", sel([[240,"240"],[320,"320"],[360,"360"],[480,"480"]], P.width, v => { P.width = +v; save(); })),
      lab("처음/끝 멈춤", sel([[0,"없음"],[0.5,"0.5초"],[1,"1초"],[2,"2초"]], P.pause, v => { P.pause = +v; save(); }))),
    lab("내려가는 속도", h("input", { type:"range", min:1, max:12, value:P.speed, oninput:e => { P.speed = +e.target.value; save(); } })),
    h("div", { class:"btns" }, h("button", { class:"btn v", onclick: build }, "📜 스크롤 GIF 만들기")),
    status
  );
  showList();
}

/* ================= 소스 7: 효과 GIF ================= */
const FX = [["holy","✨ 빛 내림 (성녀 강림)"],["speed","💥 집중선"],["shake","😱 충격 흔들림"],["pulse","💓 두근두근"],["kenburns","🔍 천천히 확대"],["pan","↔️ 좌우 훑기"],["sparkle","⭐ 반짝반짝"],["sakura","🌸 벚꽃"],["snow","❄️ 눈"],["rain","🌧 비"],["glitch","📺 글리치"]];
function renderFxFrames(img, F){
  const [iw, ih] = dimOf(img);
  let W, H;
  if (F.ratio === "orig"){ const k = 480 / Math.max(iw, ih); W = Math.round(iw*k); H = Math.round(ih*k); }
  else { const [a, b] = F.ratio.split(":").map(Number); if (a >= b){ W = 480; H = Math.round(480*b/a); } else { H = 480; W = Math.round(480*a/b); } }
  const n = Math.max(2, Math.round(F.sec * F.fps)), out = [], P = rnd(42);
  const parts = Array.from({ length: 140 }, () => ({ x: P(), y: P(), s: P(), ph: P(), k: 1 + Math.floor(P()*2) }));
  const md = Math.min(W, H), st = F.power;
  for (let f = 0; f < n; f++){
    const t = f / n, R = rnd(f * 13 + 5);
    const cv = mkCanvas(W, H), ctx = cv.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    let s = 1, dx = 0, dy = 0, rot = 0;
    if (F.fx === "kenburns"){ s = 1 + .12*st*(.5 - .5*Math.cos(Math.PI*2*t)); dx = Math.sin(Math.PI*2*t) * W * .02; }
    if (F.fx === "shake"){ s = 1.1; if (t < .55){ const a = (1 - t/.55) * W * .035 * st; dx = (R()-.5)*2*a; dy = (R()-.5)*2*a; rot = (R()-.5)*.04*st; } }
    if (F.fx === "pulse") s = 1 + .05*st*beat(t);
    if (F.fx === "pan"){ s = 1.25 + .1*st; dx = Math.sin(Math.PI*2*t) * (s - 1) / 2 * W * .95; }
    ctx.save(); ctx.translate(W/2, H/2); ctx.rotate(rot); ctx.translate(-W/2, -H/2);
    fitDraw(ctx, img, W, H, "cover", s, dx, dy);
    ctx.restore();
    if (F.fx === "speed"){
      ctx.fillStyle = F.color;
      const cx = W/2, cy = H/2, far = Math.hypot(W, H);
      const cnt = 70 + 30*st;
      for (let i = 0; i < cnt; i++){
        const a = R() * Math.PI*2, r0 = md * (.28 + R()*.2) * (1.15 - st*.1), wd = .004 + R()*.012;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a)*r0, cy + Math.sin(a)*r0);
        ctx.lineTo(cx + Math.cos(a - wd)*far, cy + Math.sin(a - wd)*far);
        ctx.lineTo(cx + Math.cos(a + wd)*far, cy + Math.sin(a + wd)*far);
        ctx.fill();
      }
    }
    if (F.fx === "holy"){
      const glow = ctx.createRadialGradient(W/2, 0, 0, W/2, 0, H*.9);
      glow.addColorStop(0, `rgba(255,248,214,${.45 + .15*Math.sin(Math.PI*2*t)})`); glow.addColorStop(1, "rgba(255,248,214,0)");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++){
        const bx = W * (.15 + i*.14), wTop = W*.03, wBot = W*(.1 + .04*(i%3));
        const al = (.1 + .07*st) * (.6 + .4*Math.sin(Math.PI*2*(t + i/6)));
        const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(255,240,190,${al})`); g.addColorStop(1, "rgba(255,240,190,0)");
        ctx.fillStyle = g; ctx.beginPath();
        ctx.moveTo(W/2 + (bx - W/2)*.3 - wTop, 0); ctx.lineTo(W/2 + (bx - W/2)*.3 + wTop, 0); ctx.lineTo(bx + wBot, H); ctx.lineTo(bx - wBot, H); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      for (let i = 0; i < 30 + 10*st; i++){
        const p = parts[i], yy = ((p.y - t*p.k) % 1 + 1) % 1;
        ctx.fillStyle = `rgba(255,250,220,${.5 + .5*Math.sin(Math.PI*2*(t*2 + p.ph))})`;
        star4(ctx, p.x * W, yy * H, md * (.008 + p.s*.018));
      }
    }
    if (F.fx === "sparkle"){
      for (let i = 0; i < 18 + 8*st; i++){
        const p = parts[i], a = Math.max(0, Math.sin(Math.PI*2*(t*p.k + p.ph)));
        ctx.fillStyle = `rgba(255,255,255,${a})`; star4(ctx, p.x * W, p.y * H, md * (.015 + p.s*.035) * a);
      }
    }
    if (F.fx === "sakura" || F.fx === "snow"){
      const cnt = F.fx === "snow" ? 50 + 25*st : 25 + 12*st;
      for (let i = 0; i < cnt; i++){
        const p = parts[i % parts.length], yy = ((p.y + t*p.k) % 1) * (H + 40) - 20, xx = p.x*W + Math.sin(Math.PI*2*(t + p.ph)) * W * .04;
        if (F.fx === "snow"){ ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(xx, yy, md*(.004 + p.s*.008), 0, Math.PI*2); ctx.fill(); }
        else { ctx.save(); ctx.translate(xx, yy); ctx.rotate(Math.PI*2*(t*p.k + p.ph)); ctx.fillStyle = `rgba(255,${170 + Math.round(p.s*40)},${200 + Math.round(p.s*30)},.92)`; ctx.beginPath(); ctx.ellipse(0, 0, md*.018, md*.01, 0, 0, Math.PI*2); ctx.fill(); ctx.restore(); }
      }
    }
    if (F.fx === "rain"){
      ctx.fillStyle = "rgba(0,10,40,.18)"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(200,220,255,.6)"; ctx.lineWidth = Math.max(1, md*.003);
      for (let i = 0; i < 70 + 30*st; i++){
        const p = parts[i % parts.length], yy = ((p.y + t*2) % 1) * (H + 60) - 30, xx = p.x * W;
        ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - md*.01, yy + md*(.04 + p.s*.03)); ctx.stroke();
      }
    }
    if (F.fx === "glitch" && R() < .55){
      for (let i = 0; i < 4 + 2*st; i++){ const sy = R()*H, sh = R()*H*.08 + 2, sx = (R()-.5)*W*.12*st; ctx.drawImage(cv, 0, sy, W, sh, sx, sy, W, sh); }
      const im = ctx.getImageData(0, 0, W, H), d = im.data, c = new Uint8ClampedArray(d), off = Math.round(3 + R()*5*st);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const i = (y*W + x)*4, xr = Math.min(W-1, x+off), xb = Math.max(0, x-off); d[i] = c[(y*W + xr)*4]; d[i+2] = c[(y*W + xb)*4 + 2]; }
      ctx.putImageData(im, 0, 0);
    }
    out.push({ c: cv, d: Math.round(1000 / F.fps) });
  }
  return out;
}
function srcFx(box){
  const F = S.gifSrc.fx = srcOpts("fx", { fx:"holy", sec:2, fps:12, ratio:"orig", color:"#000000", power:2 }, S.gifSrc.fx);
  const thumb = h("div");
  const showThumb = () => { thumb.replaceChildren(); if (G.fxImg){ const c = toCanvas(G.fxImg, 160); c.style.cssText = "border-radius:10px;margin-top:8px;max-height:120px"; thumb.append(c); } };
  box.append(
    h("div", { class:"muted" }, "사진 한 장에 움직이는 효과를 입혀요. 캐릭터 프로필, 웹툰 강조 컷용."),
    h("div", { class:"btns" }, filePick("🖼 사진 고르기", "image/*", false, async files => { G.fxImg = await loadImg(files[0]); showThumb(); })),
    thumb,
    lab("효과", sel(FX, F.fx, v => { F.fx = v; save(); })),
    h("div", { class:"g3" },
      lab("비율", sel([["orig","원본"],["1:1","1:1"],["3:5","3:5"],["9:16","9:16"],["16:9","16:9"]], F.ratio, v => { F.ratio = v; save(); })),
      lab("길이", sel([[1,"1초"],[2,"2초"],[3,"3초"],[4,"4초"]], F.sec, v => { F.sec = +v; save(); })),
      lab("부드러움", sel([[8,"8fps"],[12,"12fps"],[15,"15fps"]], F.fps, v => { F.fps = +v; save(); }))),
    h("div", { class:"g2" },
      lab("세기", sel([[1,"약하게"],[2,"보통"],[3,"강하게"]], F.power, v => { F.power = +v; save(); })),
      lab("집중선 색", h("input", { type:"color", value:F.color, oninput:e => { F.color = e.target.value; save(); } }))),
    h("div", { class:"btns" }, h("button", { class:"btn v", onclick:() => {
      if (!G.fxImg) return toast("사진을 먼저 골라 주세요");
      addFrames(renderFxFrames(G.fxImg, F), () => { GO().fit = "cover"; });
    } }, "✨ 효과 GIF 만들기"))
  );
  showThumb();
}

/* ================= 편집기 ================= */
let pvTimer = null;
function renderEditor(ed){
  clearTimeout(pvTimer);
  ed.replaceChildren();
  const o = GO();
  if (!G.frames.length){
    ed.append(h("div", { class:"card", style:"text-align:center" }, h("div", { style:"font-size:34px" }, "🎞"), h("div", { class:"muted" }, "위에서 재료를 골라 프레임을 만들면, 여기서 다듬고 GIF로 뽑아요.")));
    return;
  }
  G.sel = Math.max(0, Math.min(G.sel, G.frames.length - 1));
  const info = h("div", { class:"tiny", style:"text-align:center;margin-top:6px" });
  const updInfo = () => {
    const { W, H } = outSize(o), sq = seqOf(o), dur = sq.reduce((s, i) => s + G.frames[i].d, 0);
    info.textContent = `${W}×${H} · ${sq.length}프레임 · ${(dur/1000).toFixed(1)}초`;
  };

  /* 미리보기 */
  const pv = h("canvas"); let playing = true, pos = 0;
  const pvc = mkCanvas(1, 1);
  function drawPv(i){
    const { W, H } = outSize(o), pw = Math.min(W, 420), ph = Math.max(1, Math.round(H * pw / W));
    if (pv.width !== pw || pv.height !== ph){ pv.width = pw; pv.height = ph; }
    const ctx = pv.getContext("2d", { willReadFrequently:true });
    compose(G.frames[i], ctx, pw, ph, o);
    if (o.filter !== "none"){ const im = ctx.getImageData(0, 0, pw, ph); gifFilter(im.data, o.filter); ctx.putImageData(im, 0, 0); }
  }
  function tick(){
    if (!pv.isConnected) return;
    const sq = seqOf(o); if (!sq.length) return;
    pos %= sq.length; const i = sq[pos++];
    drawPv(i);
    pvTimer = setTimeout(tick, Math.max(20, G.frames[i].d));
  }
  const playBtn = h("button", { class:"btn sm", onclick:() => { playing = !playing; playBtn.textContent = playing ? "⏸ 멈춤" : "▶ 재생"; clearTimeout(pvTimer); if (playing) tick(); else drawPv(G.sel); } }, "⏸ 멈춤");
  const refresh = () => { updInfo(); clearResult(); resBox.replaceChildren(); if (!playing) drawPv(G.sel); save(); };

  /* 타임라인 */
  const thumbs = h("div", { class:"thumbs" });
  const selBox = h("div");
  function thumbOf(f){
    if (!f.th){ const k = 64 / f.c.height; f.th = mkCanvas(Math.max(8, Math.round(f.c.width*k)), 64); f.th.getContext("2d").drawImage(f.c, 0, 0, f.th.width, 64); }
    const c = mkCanvas(f.th.width, 64); c.getContext("2d").drawImage(f.th, 0, 0); return c;
  }
  function drawThumbs(){
    thumbs.replaceChildren(...G.frames.map((f, i) => h("button", { class:"th" + (i === G.sel ? " on" : ""), onclick:() => { G.sel = i; drawThumbs(); drawSel(); if (!playing) drawPv(i); } }, thumbOf(f), h("span", null, i + 1))));
    const on = thumbs.querySelector(".on"); on && setTimeout(() => on.scrollIntoView({ block:"nearest", inline:"center" }), 0);
  }
  function drawSel(){
    const f = G.frames[G.sel]; if (!f) return selBox.replaceChildren();
    const i = G.sel;
    selBox.replaceChildren(
      h("div", { class:"tiny", style:"margin-bottom:4px" }, `선택: ${i + 1}번 프레임`),
      h("div", { class:"g2" },
        lab("이 프레임 시간 (ms)", h("input", { type:"number", min:20, step:10, value:f.d, oninput:e => { f.d = Math.max(20, +e.target.value || 100); refresh(); } })),
        lab("이 프레임만 자막", h("input", { type:"text", value:f.cap || "", placeholder:"비우면 전체 자막", oninput:e => { f.cap = e.target.value; refresh(); } }))),
      h("div", { class:"btns" },
        h("button", { class:"btn sm", onclick:() => { if (i > 0){ G.frames.splice(i, 1); G.frames.splice(i - 1, 0, f); G.sel--; drawThumbs(); drawSel(); refresh(); } } }, "◀ 앞으로"),
        h("button", { class:"btn sm", onclick:() => { if (i < G.frames.length - 1){ G.frames.splice(i, 1); G.frames.splice(i + 1, 0, f); G.sel++; drawThumbs(); drawSel(); refresh(); } } }, "뒤로 ▶"),
        h("button", { class:"btn sm", onclick:() => { G.frames.splice(i + 1, 0, { c: f.c, d: f.d, cap: f.cap, th: f.th }); G.sel++; drawThumbs(); drawSel(); refresh(); } }, "⧉ 복제"),
        h("button", { class:"btn sm", onclick:async () => { const { W, H } = outSize(o), c = mkCanvas(W, H); compose(f, c.getContext("2d"), W, H, o); const im = c.getContext("2d").getImageData(0, 0, W, H); gifFilter(im.data, o.filter); c.getContext("2d").putImageData(im, 0, 0); c.toBlob(b => saveFile(fname("png", "_" + (i + 1)), b, "이 화면에서는 파일 저장이 안 돼요"), "image/png"); } }, "🖼 PNG"),
        h("button", { class:"btn sm d", onclick:() => { G.frames.splice(i, 1); if (!G.frames.length){ clearResult(); gifRerender(); return; } G.sel = Math.min(i, G.frames.length - 1); drawThumbs(); drawSel(); refresh(); } }, "삭제"))
    );
  }

  /* 설정 */
  const cap = h("textarea", { value:o.cap, placeholder:"모든 프레임에 들어갈 자막 (줄바꿈 가능)", style:"min-height:54px", oninput:e => { o.cap = e.target.value; refresh(); } });
  const FILTERS = [["none","원본"],["gray","흑백"],["noir","느와르"],["sepia","세피아"],["vintage","빈티지"],["warm","따뜻하게"],["cool","차갑게"],["bright","밝게"],["contrast","선명하게"],["pastel","파스텔"],["comic","만화톤"],["invert","반전"]];
  const fBox = h("div");
  const drawF = () => fBox.replaceChildren(...FILTERS.map(([k, t]) => h("button", { class:"pill" + (o.filter === k ? " on" : ""), onclick:() => { o.filter = k; drawF(); refresh(); } }, t)));
  const widthLbl = h("span");
  const setW = v => { o.width = v; widthLbl.textContent = v + "px"; };

  /* 만들기 */
  const bar = h("div", { class:"prog hidden" }, h("i", { style:"width:0" }));
  const barTxt = h("div", { class:"tiny" });
  const resBox = h("div");
  const makeBtn = h("button", { class:"btn p", style:"width:100%;padding:13px;font-size:15px", onclick: make }, "🎞 GIF 만들기");
  async function make(){
    makeBtn.disabled = true; bar.classList.remove("hidden"); resBox.replaceChildren();
    const setP = (p, msg) => { bar.firstChild.style.width = Math.round(p*100) + "%"; barTxt.textContent = msg || (p < .1 ? "색 분석 중…" : p < .8 ? "색 줄이고 프레임 정리 중…" : "LZW 압축 중…") + " " + Math.round(p*100) + "%"; };
    try {
      const { W, H } = outSize(o), sq = seqOf(o);
      setP(0, "프레임 준비 중…"); await sleep(20);
      const cv = mkCanvas(W, H), cx = cv.getContext("2d", { willReadFrequently:true });
      const frames = [], delays = [];
      for (let k = 0; k < sq.length; k++){
        const f = G.frames[sq[k]];
        compose(f, cx, W, H, o);
        frames.push(cx.getImageData(0, 0, W, H).data.buffer);
        delays.push(f.d);
        if (k % 10 === 9){ setP(0, `프레임 준비 중… ${k + 1}/${sq.length}`); await sleep(0); }
      }
      const t0 = performance.now();
      const bytes = await runEncode({ w:W, h:H, frames, delays, colors:+o.colors, dither:o.dither, optimize:!!o.optimize, transparent:!!o.transparent, filter:o.filter, loop:+o.loop }, p => setP(p));
      clearResult();
      G.result = new Blob([bytes], { type:"image/gif" });
      G.resultUrl = URL.createObjectURL(G.result);
      setP(1, `완성! (${((performance.now() - t0)/1000).toFixed(1)}초)`);
      showResult();
    } catch(e){ barTxt.textContent = "⚠ 실패: " + e.message; }
    makeBtn.disabled = false;
  }
  function showResult(){
    if (!G.result) return;
    const { W, H } = outSize(o), kb = G.result.size / 1024;
    resBox.replaceChildren(
      h("div", { class:"pvwrap", style:"margin-top:10px" }, h("img", { src:G.resultUrl, alt:"완성된 GIF" })),
      h("div", { class:"tiny", style:"text-align:center;margin-top:6px" }, `${kb >= 1024 ? (kb/1024).toFixed(2) + "MB" : Math.round(kb) + "KB"} · ${W}×${H}`),
      kb > 8*1024 ? h("div", { class:"warnbox" }, "💡 용량이 커요. 가로 크기, 색 수, 프레임 수를 줄이면 작아져요.") : h("div"),
      h("div", { class:"btns" },
        h("button", { class:"btn p", onclick:() => saveFile(fname("gif"), G.result, "위 결과 이미지를 길게 눌러 '사진에 저장'을 눌러 주세요") }, "💾 GIF 저장"),
        h("button", { class:"btn", onclick: recordVideo }, "🎥 동영상으로 저장"),
        h("button", { class:"btn", onclick: spriteSheet }, "🧩 스프라이트 PNG"))
    );
  }
  async function recordVideo(){
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast("이 브라우저는 동영상 저장을 못 해요");
    const mt = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch(e){ return false; } });
    if (!mt) return toast("이 브라우저는 동영상 저장을 못 해요");
    let { W, H } = outSize(o); W -= W % 2; H -= H % 2;
    const cv = mkCanvas(W, H); cv.style.cssText = "max-width:100%;border-radius:8px;margin-top:8px";
    const ctx = cv.getContext("2d", { willReadFrequently:true });
    const note = h("div", { class:"tiny" }, "🔴 녹화 중… (실제 재생 시간만큼 걸려요)");
    resBox.append(note, cv);
    const oo = Object.assign({}, o, { transparent:false });
    const draw = f => { compose(f, ctx, W, H, oo); if (o.filter !== "none"){ const im = ctx.getImageData(0, 0, W, H); gifFilter(im.data, o.filter); ctx.putImageData(im, 0, 0); } };
    const sq = seqOf(o), dur = sq.reduce((s, i) => s + G.frames[i].d, 0), reps = Math.max(1, Math.min(10, Math.ceil(3000 / dur)));
    draw(G.frames[sq[0]]);
    const stream = cv.captureStream(30), chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 5e6 });
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => rec.onstop = r);
    rec.start(200);
    for (let r = 0; r < reps; r++) for (const i of sq){ draw(G.frames[i]); await sleep(G.frames[i].d); }
    rec.stop(); await stopped;
    note.remove(); cv.remove();
    const blob = new Blob(chunks, { type: mt.split(";")[0] });
    saveFile(fname(mt.includes("mp4") ? "mp4" : "webm"), blob, "이 화면에서는 파일 저장이 안 돼요");
  }
  function spriteSheet(){
    const { W, H } = outSize(o), n = G.frames.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const k = Math.min(1, 4096 / Math.max(W*cols, H*rows)), w = Math.round(W*k), hh = Math.round(H*k);
    const cv = mkCanvas(w*cols, hh*rows), ctx = cv.getContext("2d"), tmp = mkCanvas(w, hh), tx = tmp.getContext("2d", { willReadFrequently:true });
    G.frames.forEach((f, i) => { compose(f, tx, w, hh, o); if (o.filter !== "none"){ const im = tx.getImageData(0, 0, w, hh); gifFilter(im.data, o.filter); tx.putImageData(im, 0, 0); } ctx.drawImage(tmp, (i % cols)*w, Math.floor(i / cols)*hh); });
    cv.toBlob(b => saveFile(fname("png", "_sprite"), b, "이 화면에서는 파일 저장이 안 돼요"), "image/png");
  }

  ed.append(
    h("div", { class:"card" }, h("h3", null, "👀 미리보기"), h("div", { class:"pvwrap" }, pv), info,
      h("div", { class:"btns", style:"justify-content:center" }, playBtn)),
    h("div", { class:"card" }, h("h3", null, "🎞 프레임 ", h("span", { class:"tiny" }, G.frames.length + "장")), thumbs, selBox,
      h("div", { class:"btns", style:"border-top:1px solid var(--line);padding-top:8px" },
        h("button", { class:"btn sm", onclick:() => { G.frames.forEach(f => f.d = Math.max(20, Math.round(f.d / 2))); drawSel(); refresh(); } }, "⏩ 2배 빠르게"),
        h("button", { class:"btn sm", onclick:() => { G.frames.forEach(f => f.d = Math.round(f.d * 2)); drawSel(); refresh(); } }, "🐢 2배 느리게"),
        h("button", { class:"btn sm", onclick:() => askText("모든 프레임 시간 (ms)", String(G.frames[G.sel].d), v => { const ms = Math.max(20, parseInt(v) || 100); G.frames.forEach(f => f.d = ms); drawSel(); refresh(); }) }, "⏱ 일괄 시간"),
        h("button", { class:"btn sm", onclick:() => { if (G.frames.length < 4) return toast("프레임이 너무 적어요"); G.frames = G.frames.filter((f, i) => { if (i % 2 === 0){ const nx = G.frames[i + 1]; if (nx) f.d += nx.d; return true; } return false; }); G.sel = 0; drawThumbs(); drawSel(); refresh(); toast("절반으로 솎았어요"); } }, "✂️ 반으로 솎기"),
        h("button", { class:"btn sm", onclick:() => { G.frames.reverse(); drawThumbs(); drawSel(); refresh(); } }, "🔄 순서 뒤집기"),
        h("button", { class:"btn sm d", onclick:() => confirmSheet("프레임을 모두 지울까요?", "모두 지우기", () => { G.frames = []; clearResult(); gifRerender(); }) }, "전체 비우기"))),
    h("div", { class:"card" }, h("h3", null, "📐 크기·재생"),
      h("label", { class:"f" }, "가로 크기 ", widthLbl),
      h("input", { type:"range", min:120, max:800, step:20, value:o.width, oninput:e => { setW(+e.target.value); refresh(); } }),
      h("div", { class:"g3" },
        lab("비율", sel([["auto","원본"],["1:1","1:1"],["3:5","3:5"],["4:5","4:5"],["9:16","9:16"],["16:9","16:9"]], o.ratio, v => { o.ratio = v; refresh(); })),
        lab("맞춤", sel([["cover","꽉 채우기"],["contain","전체 보이기"]], o.fit, v => { o.fit = v; refresh(); })),
        lab("빈 곳 색", h("input", { type:"color", value:o.bg, oninput:e => { o.bg = e.target.value; refresh(); } }))),
      h("div", { class:"g2" },
        lab("재생 방향", sel([["fwd","정방향"],["rev","거꾸로"],["ping","왕복 (부메랑)"]], o.dir, v => { o.dir = v; pos = 0; refresh(); })),
        lab("반복", sel([[0,"무한 반복"],[1,"1번만"],[2,"2번"],[3,"3번"],[5,"5번"]], o.loop, v => { o.loop = +v; refresh(); })))),
    h("div", { class:"card" }, h("h3", null, "💬 자막"), cap,
      h("div", { class:"g3" },
        lab("위치", sel([["top","위"],["middle","가운데"],["bottom","아래"]], o.capPos, v => { o.capPos = v; refresh(); })),
        lab("글자색", h("input", { type:"color", value:o.capColor, oninput:e => { o.capColor = e.target.value; refresh(); } })),
        lab("테두리", h("input", { type:"color", value:o.capStroke === "none" ? "#000000" : o.capStroke, oninput:e => { o.capStroke = e.target.value; refresh(); } }))),
      h("div", { class:"g2" },
        lab("글꼴", sel(FONTS, o.capFont, v => { o.capFont = v; document.fonts && document.fonts.load(`20px "${v}"`, "가").then(refresh, refresh); })),
        lab("크기", h("input", { type:"range", min:4, max:22, value:o.capSize, oninput:e => { o.capSize = +e.target.value; refresh(); } })))),
    h("div", { class:"card" }, h("h3", null, "🎨 필터"), fBox),
    h("details", { class:"card" }, h("summary", null, "⚙️ 엔진 설정 (화질·용량)"),
      h("div", { class:"g2" },
        lab("색 수", sel([[256,"256 (최고 화질)"],[128,"128"],[64,"64"],[32,"32 (작은 용량)"],[16,"16"],[8,"8 (레트로)"]], o.colors, v => { o.colors = +v; refresh(); })),
        lab("디더링", sel([["bayer","바이어 (애니에 추천)"],["fs","플로이드 (사진에 추천)"],["none","없음 (그림·글자)"]], o.dither, v => { o.dither = v; refresh(); }))),
      h("label", { class:"check" }, h("input", { type:"checkbox", checked:o.optimize, onchange:e => { o.optimize = e.target.checked; refresh(); } }), h("div", null, "변화 영역만 저장 ", h("span", { class:"tiny" }, "(용량 크게 줄어듦)"))),
      h("label", { class:"check", style:"border:0" }, h("input", { type:"checkbox", checked:o.transparent, onchange:e => { o.transparent = e.target.checked; refresh(); } }), h("div", null, "투명 배경 ", h("span", { class:"tiny" }, "(스티커용 · 이때는 영역 최적화 꺼짐)")))),
    h("div", { class:"card" }, makeBtn, bar, barTxt, resBox,
      h("div", { class:"engine" }, "⚙️ 자체 GIF 엔진 — 외부 라이브러리 없이 직접 구현", h("br"), "미디언 컷 색 양자화 · 바이어/플로이드 디더링 · LZW 압축 · 변화 영역 최적화 · GIF 디코더"))
  );
  setW(o.width); drawF(); drawThumbs(); drawSel(); updInfo(); showResult();
  tick();
}
function fname(ext, suffix){
  const idx = Math.max(0, S.order.indexOf(S.cur)) + 1;
  const base = "zeta" + idx;   // 한글 파일 이름은 일부 폰에서 'download'로 바뀌어서 영문으로
  const d = new Date(), ts = `${d.getMonth() + 1}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${base}_${ts}${suffix || ""}.${ext}`;
}

VIEWS.gif = (body) => {
  S.gifSrc = S.gifSrc || {};
  GO();
  const SRC = [["photo","📷 사진"],["video","🎥 영상"],["gifin","🎞 GIF 열기"],["draw","✏️ 그리기"],["text","🔤 글자"],["scroll","📜 스크롤"],["fx","✨ 효과"]];
  const FN = { photo: srcPhoto, video: srcVideo, gifin: srcGifIn, draw: srcDraw, text: srcText, scroll: srcScroll, fx: srcFx };
  const tabs = h("div", { class:"tabs" }), srcBox = h("div", { class:"card" }), ed = h("div", { id:"gifEditor" });
  const drawTabs = () => tabs.replaceChildren(...SRC.map(([k, t]) => h("button", { class:"pill" + ((S.gifTab || "photo") === k ? " on" : ""), onclick:() => { S.gifTab = k; save(); drawTabs(); drawSrc(); } }, t)));
  const drawSrc = () => { srcBox.replaceChildren(); (FN[S.gifTab || "photo"] || srcPhoto)(srcBox); };
  gifRerender = () => { if (ed.isConnected) renderEditor(ed); };
  body.append(h("div", { class:"tiny", style:"margin-bottom:6px" }, "① 재료 고르기"), tabs, srcBox, h("div", { class:"tiny", style:"margin:14px 0 6px" }, "② 다듬고 뽑기"), ed);
  drawTabs(); drawSrc(); renderEditor(ed);
};
