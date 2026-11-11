// 올리기 전에 - 장면 판단 AI (MobileCLIP S0, 브라우저 안에서 실행)
// 사진 전체를 보고 "신분증 같아요", "택배 상자 같아요", "교복·책가방 같아요"처럼 장면을 판단한다.
// 장면 설명 문장의 임베딩은 미리 계산해 두었고(scene_labels.json), 여기서는 이미지 모델만 돌린다.
(function () {
  'use strict';
  const abs = p => new URL(p, location.href).href;
  let ready = null, labels = null, scale = 100;

  function load(onProgress) {
    if (!ready) {
      ready = (async () => {
        ort.env.wasm.wasmPaths = abs('vendor/ort/');
        ort.env.wasm.numThreads = 1; // 별도 서버 설정 없이 어디서나 돌도록 한 줄로 실행
        onProgress && onProgress('장면 AI 받는 중…');
        const [buf, lab] = await Promise.all([
          fetchWithProgress(abs('vendor/clip/mobileclip_s0_vision_fp16.onnx'), onProgress),
          fetch(abs('vendor/clip/scene_labels.json')).then(r => r.json()),
        ]);
        labels = lab.labels.map(l => ({ ...l, emb: Float32Array.from(l.emb) }));
        scale = lab.scale || 100;
        return ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      })();
    }
    return ready;
  }

  async function fetchWithProgress(url, onProgress) {
    // 서버가 압축해서 보내면 content-length(압축 크기)와 실제로 받는 크기가 다르다.
    // 그래서 조각을 모아 두었다가 마지막에 합치고, 진행률은 대략만 보여 준다.
    const EXPECT = 22876479; // 모델 파일의 실제 크기
    const res = await fetch(url);
    if (!res.ok) throw new Error('장면 AI 파일을 받지 못했어요 (' + res.status + ')');
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress && onProgress(`장면 AI 받는 중 ${Math.min(99, Math.round(got / EXPECT * 100))}%`);
    }
    const out = new Uint8Array(got);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  // 짧은 변을 256으로 맞추고 가운데 256×256을 잘라 0~1로 바꾼다 (모델이 학습한 방식 그대로)
  function toTensor(src) {
    const S = 256, side = Math.min(src.width, src.height);
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    const x = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) {
      x[i] = d[i * 4] / 255; x[S * S + i] = d[i * 4 + 1] / 255; x[2 * S * S + i] = d[i * 4 + 2] / 255;
    }
    return new ort.Tensor('float32', x, [1, 3, S, S]);
  }

  // 장면별 확률을 돌려준다: [{key, ko, level, msg, p}] (높은 순)
  async function classify(src) {
    const sess = await load();
    const out = await sess.run({ [sess.inputNames[0]]: toTensor(src) });
    const v = out[sess.outputNames[0]].data;
    let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n);
    const logits = labels.map(l => { let s = 0; for (let i = 0; i < v.length; i++) s += l.emb[i] * v[i]; return scale * s / n; });
    const mx = Math.max(...logits);
    const ex = logits.map(z => Math.exp(z - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    const agg = {};
    labels.forEach((l, i) => {
      const a = agg[l.key] || (agg[l.key] = { key: l.key, ko: l.ko, level: l.level, msg: l.msg, p: 0 });
      a.p += ex[i] / sum;
    });
    return Object.values(agg).sort((a, b) => b.p - a.p);
  }

  window.Scene = { load, classify };
})();
