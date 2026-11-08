// AVIF 인코딩 전용 워커 — 화면 멈춤 없이 변환
import encode from './avif/encode.js';
self.onmessage = async (e) => {
  const { id, data, width, height, quality, speed } = e.data;
  try {
    const buf = await encode({ data, width, height, colorSpace: 'srgb' }, { quality, speed });
    self.postMessage({ id, buf }, [buf]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
