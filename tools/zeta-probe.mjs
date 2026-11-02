// 1회용: 제타 공개 페이지 구조 확인용 샘플 저장
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("data/_probe", { recursive: true });
const UA = "Mozilla/5.0 (compatible; ZetaStudioBot/1.0; +https://deca19.github.io/zeta/)";
const urls = {
  home: "https://zeta-ai.io/ko",
  ranking: "https://zeta-ai.io/ko?tab=ranking",
  plot: "https://zeta-ai.io/ko/plots/295e16df-dc36-43f3-b1c1-1ed3fb8b92c5/profile",
  sitemap: "https://zeta-ai.io/sitemap.xml",
};
for (const [k, u] of Object.entries(urls)){
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" } });
    const t = await r.text();
    writeFileSync(`data/_probe/${k}.html`, t);
    writeFileSync(`data/_probe/${k}.meta.json`, JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), len: t.length }, null, 1));
    console.log(k, r.status, t.length);
  } catch(e){ console.log(k, "ERR", e.message); }
  await new Promise(r => setTimeout(r, 1500));
}
