// AVIF 인코딩 전용 워커 — 10비트로 인코딩(그라데이션 계단 현상 ↓, 용량 ↓), 화면 멈춤 없음
import encode from './avif/encode.js';
self.onmessage = async (e) => {
  const { id, data, width, height, quality, speed } = e.data;
  try {
    const d16 = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) d16[i] = (data[i] * 1023 + 127) / 255 | 0;
    const buf = await encode({ data: d16, width, height }, { quality, speed, bitDepth: 10 });
    self.postMessage({ id, buf }, [buf]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
