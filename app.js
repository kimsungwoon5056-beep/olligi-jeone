// 올리기 전에 - 화면과 AI 모델 연결
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  // 모든 AI 라이브러리와 모델 파일은 이 사이트 안(vendor/)에 있다. 다른 곳에서 받아 오지 않는다.
  const abs = p => new URL(p, location.href).href;
  const MP = abs('vendor/mediapipe');
  const FACE_MODEL = abs('vendor/mediapipe/blaze_face_short_range.tflite');
  const WORK_MAX = 1600; // 분석용 긴 변 최대 길이
  const LEVEL_COLOR = { 3: '#d93a3a', 2: '#e07b00', 1: '#8a8f00' };

  const S = {
    img: null, buffer: null, W: 0, H: 0, k: 1, // k: 원본 → 분석 화면 배율
    work: document.createElement('canvas'),
    findings: [], gps: null, meta: null, qrFound: [], ocrText: '',
    style: 'mosaic', drag: null, busy: false, lastBlob: null, hover: null, preview: false, skewDeg: 0,
    context: 'market', sceneOn: true, scene: null, photoNo: 0,
    test: { on: false, photos: {} }, // 시험 모드 기록 (이 탭의 메모리에만 있음)
  };

  // ---------- AI 모델 (처음 한 번만 받고 다시 씀) ----------
  // 글자 읽기 일꾼을 CPU 코어 수에 맞춰 1~3개 띄워, 여러 판을 동시에 읽는다.
  let ocrP = null, faceP = null;
  const OCR_N = (() => {
    const cores = navigator.hardwareConcurrency || 2;
    const mem = navigator.deviceMemory || 8;
    return mem <= 3 ? 1 : Math.max(1, Math.min(3, Math.floor(cores / 2)));
  })();
  function getOcrPool() {
    if (!ocrP) {
      const logger = m => {
        if (m.status && m.progress != null && !m.status.includes('recogniz')) {
          setModel(`글자 읽기 모델 받는 중 ${Math.round(m.progress * 100)}%`);
        }
      };
      ocrP = (async () => {
        const opts = {
          workerPath: abs('vendor/tesseract/worker.min.js'), corePath: abs('vendor/tesseract-core'),
          langPath: abs('vendor/lang'), workerBlobURL: false,
        };
        const first = await Tesseract.createWorker('kor+eng', 1, { ...opts, logger });
        const rest = await Promise.all(Array.from({ length: OCR_N - 1 }, () => Tesseract.createWorker('kor+eng', 1, opts)));
        return [first, ...rest];
      })();
    }
    return ocrP;
  }
  // 일꾼들에게 일을 나눠 주고, 들어온 순서대로 결과를 돌려준다
  async function ocrAll(jobs, onDone) {
    const pool = await getOcrPool();
    const out = new Array(jobs.length);
    let next = 0, done = 0;
    await Promise.all(pool.map(async w => {
      while (next < jobs.length) {
        const i = next++;
        await w.setParameters({ tessedit_pageseg_mode: jobs[i].psm });
        const { data } = await w.recognize(jobs[i].canvas);
        if (jobs[i].back) mapLines(data, jobs[i].back);
        out[i] = data;
        onDone(++done, jobs.length);
      }
    }));
    return out;
  }
  function getFace() {
    if (!faceP) {
      faceP = (async () => {
        const v = await import(MP + '/vision_bundle.js');
        const files = await v.FilesetResolver.forVisionTasks(MP + '/wasm');
        return v.FaceDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
          runningMode: 'IMAGE', minDetectionConfidence: 0.5,
        });
      })();
    }
    return faceP;
  }

  // ---------- 예시 사진 ----------
  function renderSamples() {
    const box = $('#samples');
    (window.SAMPLES || []).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sample';
      b.innerHTML = `<img alt="" src="${s.src}"><b>${s.title}</b><small>${s.desc}</small>`;
      b.onclick = () => loadFromDataUrl(s.src);
      box.appendChild(b);
    });
  }
  function dataUrlToBuffer(url) {
    const bin = atob(url.split(',')[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }
  function showMsg(t) { const m = $('#pickMsg'); m.textContent = t; m.classList.toggle('hidden', !t); }
  async function loadFromDataUrl(url) {
    try { showMsg(''); start(await loadImage(url), dataUrlToBuffer(url)); }
    catch (e) { showMsg('사진을 열 수 없어요. 다른 사진을 골라 주세요.'); }
  }
  async function loadFromFile(file) {
    try {
      showMsg('');
      const buf = await file.arrayBuffer();
      const url = URL.createObjectURL(file);
      start(await loadImage(url), buf);
    } catch (e) {
      showMsg('이 사진은 열 수 없어요. JPG나 PNG 사진을 골라 주세요. (아이폰 HEIC 사진은 카메라 설정에서 ‘높은 호환성’을 고르면 돼요)');
    }
  }

  // ---------- AI 준비 상태와 '바깥으로 나간 요청' 세기 ----------
  function setModel(text, state) {
    const m = $('#modelStatus');
    m.textContent = text;
    m.className = 'model ' + (state || '');
  }
  let readyAt = null;
  function outgoingAfterReady() {
    if (readyAt == null) return null;
    // 이 사이트(자기 자신)가 아닌 곳으로 나간 요청만 센다
    return performance.getEntriesByType('resource')
      .filter(e => e.startTime > readyAt && /^https?:/.test(e.name) && new URL(e.name).origin !== location.origin).length;
  }
  function renderNet() {
    const n = outgoingAfterReady();
    $('#netCount').textContent = n == null ? 'AI 준비 뒤부터 셀게요' : `${n}건`;
    $('#netState').textContent = navigator.onLine ? '연결됨' : '끊김 (그래도 분석은 돼요)';
  }

  // ---------- 단계 표시와 시간 재기 ----------
  const STEPS = [
    ['meta', '숨은 정보 읽기 (위치·기기)'],
    ['ocr', '글자 읽기 (OCR)'],
    ['face', '얼굴 찾기'],
    ['scene', '장면 판단 AI'],
    ['qr', 'QR·바코드 찾기'],
    ['agent', '개인정보 판단·위험 설명'],
  ];
  let times = {};
  // 전체 진행 막대: 단계마다 걸리는 시간 비율로 나눈다 (글자 읽기가 대부분)
  const WEIGHT = { meta: 0.03, ocr: 0.72, face: 0.08, scene: 0.10, qr: 0.04, agent: 0.03 };
  let prog = {};
  function setBar(id, frac) {
    prog[id] = frac;
    const p = Object.keys(WEIGHT).reduce((a, k) => a + WEIGHT[k] * (prog[k] || 0), 0);
    $('#barFill').style.width = Math.round(p * 100) + '%';
    $('#bar').setAttribute('aria-valuenow', Math.round(p * 100));
  }
  function resetSteps() {
    times = {}; prog = {};
    $('#steps').innerHTML = STEPS.map(([id, name]) => `<li id="st-${id}"><span>${name}</span><span class="st">기다리는 중</span></li>`).join('');
    $('#bar').classList.remove('hidden');
    setBar('meta', 0);
  }
  function setStep(id, text, done) {
    const li = $('#st-' + id);
    if (!li) return;
    const st = li.querySelector('.st');
    st.textContent = text;
    st.className = 'st' + (done ? ' done' : '');
    if (done) setBar(id, 1);
  }
  async function timed(id, fn) {
    setStep(id, '진행 중…');
    const t0 = performance.now();
    try {
      const r = await fn();
      const ms = performance.now() - t0;
      times[id] = ms;
      setStep(id, `✓ ${fmtMs(ms)}`, true);
      return r;
    } catch (e) {
      console.error(id, e);
      times[id] = null;
      setStep(id, '건너뜀 (오류)');
      return null;
    }
  }
  function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + '초' : Math.round(ms) + 'ms'; }
  function renderPerf() {
    const rows = STEPS.map(([id, name]) => `<tr><td>${name}</td><td>${times[id] == null ? '-' : fmtMs(times[id])}</td></tr>`);
    const total = Object.values(times).filter(v => v != null).reduce((a, b) => a + b, 0);
    rows.push(`<tr><th>합계</th><th>${fmtMs(total)}</th></tr>`);
    $('#perf').innerHTML = '<tr><th>단계</th><th>시간</th></tr>' + rows.join('');
    $('#device').textContent = `측정 기기: CPU 코어 ${navigator.hardwareConcurrency || '?'}개 · 글자 읽기 일꾼 ${OCR_N}개 동시 실행 · 사진 ${S.W}×${S.H}${S.skewDeg && Math.abs(S.skewDeg) >= 2 ? ` · 기울기 ${Math.abs(S.skewDeg)}° 바로잡음` : ''} · 처음 실행에는 모델 받는 시간이 들어가요.`;
    renderNet();
  }

  // ---------- 분석 ----------
  async function start(img, buffer) {
    if (S.busy) return;
    S.busy = true;
    S.img = img; S.buffer = buffer; S.W = img.naturalWidth; S.H = img.naturalHeight;
    S.k = Math.min(1, WORK_MAX / Math.max(S.W, S.H));
    S.work.width = Math.round(S.W * S.k); S.work.height = Math.round(S.H * S.k);
    S.work.getContext('2d').drawImage(img, 0, 0, S.work.width, S.work.height);
    S.findings = []; S.gps = null; S.meta = null; S.qrFound = []; S.ocrText = ''; S.hover = null; S.preview = false; S.skewDeg = 0; S.scene = null;
    $('#previewToggle').checked = false;
    $('#workCard').classList.remove('hidden');
    $('#report').classList.add('hidden');
    $('#findWrap').classList.add('hidden');
    $('#saveCard').classList.add('hidden');
    $('#result').classList.add('hidden');
    resetSteps();
    draw();
    $('#workCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // 1) 숨은 정보 (EXIF)
    await timed('meta', async () => {
      try {
        const gps = await exifr.gps(S.buffer);
        if (gps && isFinite(gps.latitude) && isFinite(gps.longitude)) S.gps = gps;
      } catch (e) { /* 위치 정보 없음 */ }
      try {
        const t = await exifr.parse(S.buffer);
        if (t) {
          const parts = [];
          if (t.Make || t.Model) parts.push(`기기 ${[t.Make, t.Model].filter(Boolean).join(' ')}`);
          const dt = t.DateTimeOriginal || t.ModifyDate;
          if (dt) parts.push(`찍은 때 ${dt instanceof Date ? dt.toLocaleString('ko-KR') : dt}`);
          if (parts.length) S.meta = parts.join(', ');
        }
      } catch (e) { /* 없음 */ }
    });

    // 2) 글자 읽기 → 3) 얼굴 → 4) QR
    // 한 번에 잘 안 읽히는 글자(말풍선, 색 바탕, 흰 글씨 표지판)를 놓치지 않으려고 네 가지로 읽고 합친다.
    //  1) 사진 그대로  2) 진한 글자를 살린 판  3) 밝은 글자를 살린 판  4) 사진 그대로 + 글자 덩어리 자동 찾기
    //  사진이 기울어 있으면(2도 이상) 똑바로 돌린 판으로 두 번 더 읽는다.
    let deskew = null;
    const ocr = await timed('ocr', async () => {
      const dark = adaptive(S.work, false);
      const angle = estimateSkew(dark);
      S.skewDeg = Math.round(angle * 180 / Math.PI * 10) / 10;
      const jobs = [
        { canvas: S.work, psm: '6' }, { canvas: dark, psm: '6' },
        { canvas: adaptive(S.work, true), psm: '6' }, { canvas: S.work, psm: '3' },
      ];
      if (Math.abs(S.skewDeg) >= 2) {
        deskew = rotateCanvas(S.work, angle);
        jobs.push({ canvas: deskew.canvas, psm: '6', back: deskew.back },
          { canvas: adaptive(deskew.canvas, false), psm: '6', back: deskew.back });
      }
      const tilt = deskew ? ` · 기울기 ${Math.abs(S.skewDeg)}° 바로잡음` : '';
      setStep('ocr', `읽는 중 0/${jobs.length}${tilt}`);
      return ocrAll(jobs, (d, n) => { setStep('ocr', `읽는 중 ${d}/${n}${tilt}`); setBar('ocr', d / n); });
    });
    const faces = await timed('face', async () => {
      const fd = await getFace();
      return detectFaces(fd, S.work);
    });
    let scene = null;
    if (S.sceneOn) {
      scene = await timed('scene', async () => {
        if (!sceneReady) setStep('scene', '장면 AI 받는 중… (처음 한 번만)');
        return Scene.classify(S.work);
      });
    } else {
      setStep('scene', '꺼 둠', true);
    }
    let bars = [];
    const qr = await timed('qr', async () => {
      bars = findBarcodes(S.work);
      if (deskew) {
        findBarcodes(deskew.canvas).map(b => mapBox(b, deskew.back))
          .forEach(b => { if (!bars.some(o => overlap(o, b) > 0.4)) bars.push(b); });
      }
      const id = S.work.getContext('2d').getImageData(0, 0, S.work.width, S.work.height);
      return jsQR(id.data, id.width, id.height, { inversionAttempts: 'dontInvert' });
    });

    // 5) 판단
    await timed('agent', async () => {
      const found = [];
      if (ocr) {
        const seenLines = new Set();
        const textLines = [];
        ocr.forEach(data => {
          (data.text || '').split('\n').map(s => s.trim()).filter(s => s.length > 1).forEach(s => {
            if (!seenLines.has(s)) { seenLines.add(s); textLines.push(s); }
          });
          Detect.analyzeLines(data.lines || []).forEach(f => {
            const dup = found.some(g => (g.type === f.type || g.text === f.text) && overlap(g.box, f.box) > 0.5);
            if (!dup) found.push(f);
          });
        });
        S.ocrText = textLines.join('\n');
      }
      (faces || []).forEach(f => {
        found.push({ type: 'face', text: `확신 ${Math.round(f.score * 100)}%`, box: f.box });
      });
      if (qr && qr.location) {
        const L = qr.location;
        const xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x];
        const ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y];
        S.qrFound = Detect.scanPlainText(qr.data);
        found.push({ type: 'qr', text: S.qrFound.length ? `안에 ${S.qrFound.join('·')}` : '내용 읽음',
          box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } });
      }
      bars.forEach(b => found.push({ type: 'barcode', text: '', box: b }));
      S.findings = found.map(f => ({ ...f, box: pad(f.box, f.type === 'face' ? 0.12 : 0.06), selected: true, ai: true }));
      S.scene = scene;
      Detect.applyContext(S.findings, S.context);
      S.photoNo++;
    });

    renderAll();
    renderPerf();
    S.busy = false;
  }

  // ---------- 기울기 바로잡기 ----------
  // 글자 점들을 여러 각도로 돌려 보며, 가로줄이 가장 또렷하게 모이는 각도를 찾는다(투영 프로파일).
  function estimateSkew(bin) {
    const sc = Math.min(1, 640 / Math.max(bin.width, bin.height));
    const W = Math.round(bin.width * sc), H = Math.round(bin.height * sc);
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tg = t.getContext('2d'); tg.drawImage(bin, 0, 0, W, H);
    const d = tg.getImageData(0, 0, W, H).data;
    const xs = [], ys = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4] < 128) { xs.push(x - W / 2); ys.push(y - H / 2); }
    }
    if (xs.length < 200) return 0;
    const step = Math.max(1, Math.floor(xs.length / 30000));
    const R = Math.ceil(Math.hypot(W, H) / 2) + 2;
    const score = a => {
      const s = Math.sin(a), c = Math.cos(a), bins = new Float32Array(2 * R + 1);
      for (let i = 0; i < xs.length; i += step) bins[Math.round(xs[i] * s + ys[i] * c) + R]++;
      let v = 0; for (let k = 0; k < bins.length; k++) v += bins[k] * bins[k];
      return v;
    };
    const rad = Math.PI / 180;
    let best = 0, bestS = score(0);
    for (let deg = -20; deg <= 20; deg += 1) { const v = score(deg * rad); if (v > bestS) { bestS = v; best = deg * rad; } }
    const c0 = best;
    for (let deg = -1; deg <= 1; deg += 0.25) { const a = c0 + deg * rad, v = score(a); if (v > bestS) { bestS = v; best = a; } }
    return best;
  }
  // 캔버스를 a만큼 돌린 새 캔버스와, 돌린 좌표 → 원래 좌표로 되돌리는 함수
  function rotateCanvas(src, a) {
    const W = src.width, H = src.height, c = Math.cos(a), s = Math.sin(a);
    const RW = Math.ceil(Math.abs(W * c) + Math.abs(H * s)), RH = Math.ceil(Math.abs(W * s) + Math.abs(H * c));
    const out = document.createElement('canvas'); out.width = RW; out.height = RH;
    const g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, RW, RH);
    g.translate(RW / 2, RH / 2); g.rotate(a); g.drawImage(src, -W / 2, -H / 2);
    const back = (x, y) => {
      const dx = x - RW / 2, dy = y - RH / 2;
      return { x: dx * c + dy * s + W / 2, y: -dx * s + dy * c + H / 2 };
    };
    return { canvas: out, back };
  }
  function mapBox(b, back) {
    const p = [back(b.x0, b.y0), back(b.x1, b.y0), back(b.x0, b.y1), back(b.x1, b.y1)];
    return { x0: Math.min(...p.map(q => q.x)), y0: Math.min(...p.map(q => q.y)),
      x1: Math.max(...p.map(q => q.x)), y1: Math.max(...p.map(q => q.y)) };
  }
  function mapLines(data, back) {
    (data.lines || []).forEach(l => (l.words || []).forEach(w => { w.bbox = mapBox(w.bbox, back); }));
  }

  // ---------- 얼굴: 전체 + 4등분 조각에서 찾기 ----------
  // 얼굴 모델은 작은 입력으로 보기 때문에, 단체 사진의 작은 얼굴은 조각을 크게 보여 줘야 잡힌다.
  function detectFaces(fd, src) {
    const all = [];
    const run = (canvas, ox, oy, k) => {
      (fd.detect(canvas).detections || []).forEach(d => {
        const b = d.boundingBox;
        all.push({ score: d.categories?.[0]?.score || 0,
          box: { x0: ox + b.originX * k, y0: oy + b.originY * k, x1: ox + (b.originX + b.width) * k, y1: oy + (b.originY + b.height) * k } });
      });
    };
    run(src, 0, 0, 1);
    const W = src.width, H = src.height;
    if (Math.max(W, H) >= 700) {
      const tw = Math.round(W * 0.6), th = Math.round(H * 0.6);
      for (const [ox, oy] of [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th], [Math.round((W - tw) / 2), Math.round((H - th) / 2)]]) {
        const t = document.createElement('canvas'); t.width = tw; t.height = th;
        t.getContext('2d').drawImage(src, ox, oy, tw, th, 0, 0, tw, th);
        run(t, ox, oy, 1);
      }
    }
    // 겹치는 것은 확신이 높은 것 하나만 남긴다
    all.sort((a, b) => b.score - a.score);
    const keep = [];
    all.forEach(f => { if (!keep.some(k => overlap(k.box, f.box) > 0.4)) keep.push(f); });
    return keep;
  }

  // 겹친 넓이 ÷ 더 작은 상자 넓이 (작은 상자가 큰 상자 안에 들어 있으면 1)
  function overlap(a, b) {
    const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
    const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    return inter / (Math.min(area(a), area(b)) || 1);
  }

  // 주변 밝기와 비교해 글자만 남기는 '적응형 이진화'. invert=true면 어두운 바탕의 밝은 글자를 살린다.
  function adaptive(src, invert) {
    const W = src.width, H = src.height;
    const d = src.getContext('2d').getImageData(0, 0, W, H).data;
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = 0; x < W; x++) { s += gray[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + s; }
    }
    const r = Math.max(8, Math.round(Math.max(W, H) / 50)), C = 12;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const og = out.getContext('2d'), od = og.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const m = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const p = gray[y * W + x];
        const v = (invert ? p > m + C : p < m - C) ? 0 : 255;
        const k = (y * W + x) * 4;
        od.data[k] = od.data[k + 1] = od.data[k + 2] = v; od.data[k + 3] = 255;
      }
    }
    og.putImageData(od, 0, 0);
    return out;
  }

  // 바코드 찾기: 세로 줄무늬(가로 방향 밝기 변화는 크고, 세로 방향 변화는 거의 없는 곳)를 모은다.
  // 브라우저마다 BarcodeDetector 지원이 달라서, 어디서나 되는 간단한 영상 처리로 만들었다.
  function findBarcodes(src) {
    const sc = Math.min(1, 480 / src.width);
    const W = Math.round(src.width * sc), H = Math.round(src.height * sc);
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tg = t.getContext('2d'); tg.drawImage(src, 0, 0, W, H);
    const d = tg.getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const C = 6, cw = Math.floor(W / C), ch = Math.floor(H / C);
    const on = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      let sx = 0, sy = 0;
      for (let y = cy * C; y < cy * C + C; y++) for (let x = cx * C; x < cx * C + C; x++) {
        const i = y * W + x;
        if (x + 1 < W) sx += Math.abs(g[i + 1] - g[i]);
        if (y + 1 < H) sy += Math.abs(g[i + W] - g[i]);
      }
      sx /= C * C; sy /= C * C;
      on[cy * cw + cx] = sx > 40 && sx > 4 * sy ? 1 : 0;
    }
    // 붙어 있는 칸끼리 묶기
    const seen = new Uint8Array(cw * ch), boxes = [];
    for (let s = 0; s < cw * ch; s++) {
      if (!on[s] || seen[s]) continue;
      const q = [s]; seen[s] = 1;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
      while (q.length) {
        const c = q.pop(), x = c % cw, y = (c / cw) | 0; n++;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const k = ny * cw + nx;
          if (on[k] && !seen[k]) { seen[k] = 1; q.push(k); }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // 너무 작거나, 칸이 듬성듬성하면 바코드가 아니다
      if (bw >= 8 && bh >= 3 && n >= 0.6 * bw * bh) {
        const k = C / sc;
        boxes.push({ x0: x0 * k, y0: y0 * k, x1: (x1 + 1) * k, y1: (y1 + 1) * k });
      }
    }
    return boxes;
  }

  function pad(b, r) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0, p = Math.max(4, Math.max(w, h) * r);
    return { x0: Math.max(0, b.x0 - p), y0: Math.max(0, b.y0 - p),
      x1: Math.min(S.work.width, b.x1 + p), y1: Math.min(S.work.height, b.y1 + p) };
  }

  // ---------- 그리기 ----------
  function draw() {
    const c = $('#view');
    c.width = S.work.width; c.height = S.work.height;
    const g = c.getContext('2d');
    g.drawImage(S.work, 0, 0);
    if (S.preview) applyMasks(g, 1);
    const lw = Math.max(2, c.width / 400);
    const r = Math.max(11, c.width / 75);
    S.findings.forEach((f, i) => {
      const b = f.box, lv = Detect.TYPES[f.type].level;
      const hot = S.hover === i, dim = S.hover != null && !hot;
      const col = f.selected ? (LEVEL_COLOR[lv] || '#d93a3a') : '#9aa1b3';
      g.globalAlpha = dim ? 0.35 : 1;
      g.lineWidth = lw * (hot ? 2.5 : f.selected ? 1.5 : 1);
      g.strokeStyle = col;
      g.setLineDash(f.selected ? [] : [lw * 4, lw * 3]);
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.setLineDash([]);
      // 번호 동그라미만 상자 모서리에 붙인다 (이름은 아래 목록에서 보여 줌)
      const cx = Math.max(r, b.x0), cy = Math.max(r, b.y0);
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = col; g.fill();
      g.lineWidth = Math.max(1.5, r / 6); g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff';
      g.font = `bold ${Math.round(r * 1.15)}px "Malgun Gothic", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i + 1), cx, cy + 1);
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
      g.globalAlpha = 1;
    });
    if (S.drag && S.drag.box) {
      const b = S.drag.box;
      g.lineWidth = lw; g.strokeStyle = '#3a5bd9'; g.setLineDash([lw * 3, lw * 2]);
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); g.setLineDash([]);
    }
  }

  function renderAll() {
    draw();
    const rep = Detect.buildReport(S.findings, { gps: S.gps, meta: S.meta, qrFound: S.qrFound, context: S.context, scene: S.scene });
    S.lastReport = rep;
    const n = S.findings.filter(f => f.selected).length + (S.gps ? 1 : 0);
    $('#banner').className = 'banner l' + rep.level;
    $('#banner').textContent = `${rep.label} · 가릴 곳 ${S.findings.filter(f => f.selected).length}개${S.gps ? ' + 숨은 위치 정보' : ''}`;
    $('#risks').innerHTML = '<div class="hint" style="margin:0 0 4px">🤖 AI가 판단한 "이 사진으로 남이 알 수 있는 것"</div>' +
      rep.cards.map(c => `<div class="risk l${c.level < 0 ? 'ctx' : c.level}"><b>${esc(c.title)}</b><p>${esc(c.body)}</p></div>`).join('');
    // 장면 AI가 본 것 (위 3개를 막대로)
    if (S.scene && S.scene.length) {
      $('#sceneBox').innerHTML = '<b>🧠 장면 판단 AI가 본 이 사진</b>' + S.scene.slice(0, 3).map(s =>
        `<div class="sc"><span>${esc(s.ko)}</span><i><em style="width:${Math.round(s.p * 100)}%"></em></i><span>${Math.round(s.p * 100)}%</span></div>`).join('');
      $('#sceneBox').classList.remove('hidden');
    } else $('#sceneBox').classList.add('hidden');
    $('#report').classList.remove('hidden');
    renderTest();

    const list = $('#finds');
    list.innerHTML = '';
    S.findings.forEach((f, i) => {
      const t = Detect.TYPES[f.type];
      const li = document.createElement('li');
      const col = f.selected ? (LEVEL_COLOR[t.level] || '#d93a3a') : '#9aa1b3';
      li.innerHTML = `<label><input type="checkbox" ${f.selected ? 'checked' : ''} aria-label="${i + 1}번 ${t.label} 가리기">
        <i class="no" style="background:${col}">${i + 1}</i>
        <div><span class="kind">${t.label}</span><span class="pill l${t.level}">${['', '낮음', '중간', '높음'][t.level]}</span>
        ${f.text ? ` <span class="val">${esc(f.text)}</span>` : ''}
        <span class="why">${esc(f.note ? f.note + '. ' + t.why : t.why)}</span></div></label>`;
      li.querySelector('input').onchange = e => { f.selected = e.target.checked; f.touched = true; renderAll(); };
      const on = () => { S.hover = i; draw(); }, off = () => { S.hover = null; draw(); };
      li.addEventListener('mouseenter', on); li.addEventListener('mouseleave', off);
      li.addEventListener('focusin', on); li.addEventListener('focusout', off);
      list.appendChild(li);
    });
    if (S.gps) {
      const li = document.createElement('li');
      li.innerHTML = `<input type="checkbox" checked disabled><i class="no" style="background:#d93a3a">📍</i><div><span class="kind">숨은 위치 정보 (GPS)</span><span class="pill l3">높음</span>
        <span class="why">사진에는 안 보이지만 파일 안에 있어요. 저장하면 항상 지워져요.</span></div>`;
      list.appendChild(li);
    }
    $('#findCount').textContent = `${n}개`;
    $('#ocrText').textContent = S.ocrText.trim() || '(읽은 글자 없음)';
    $('#findWrap').classList.remove('hidden');
    $('#saveCard').classList.remove('hidden');
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- 사진 위에서 누르기·끌기 ----------
  function toCanvas(e) {
    const c = $('#view'), r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
  }
  function bindCanvas() {
    const c = $('#view');
    c.addEventListener('pointerdown', e => {
      if (!S.img || S.busy) return;
      c.setPointerCapture(e.pointerId);
      const p = toCanvas(e);
      S.drag = { x: p.x, y: p.y, box: null };
    });
    c.addEventListener('pointermove', e => {
      if (!S.drag) return;
      const p = toCanvas(e);
      S.drag.box = { x0: Math.min(S.drag.x, p.x), y0: Math.min(S.drag.y, p.y), x1: Math.max(S.drag.x, p.x), y1: Math.max(S.drag.y, p.y) };
      draw();
    });
    c.addEventListener('pointerup', e => {
      if (!S.drag) return;
      const p = toCanvas(e), d = S.drag; S.drag = null;
      const b = d.box;
      if (b && (b.x1 - b.x0) > 12 && (b.y1 - b.y0) > 12) {
        S.findings.push({ type: 'manual', text: '', box: b, selected: true });
      } else {
        // 짧게 누르면: 누른 곳의 상자를 켜고 끈다 (작은 상자 먼저)
        const hit = S.findings
          .filter(f => p.x >= f.box.x0 && p.x <= f.box.x1 && p.y >= f.box.y0 && p.y <= f.box.y1)
          .sort((a, b2) => area(a.box) - area(b2.box))[0];
        if (hit) { hit.selected = !hit.selected; hit.touched = true; }
      }
      renderAll();
    });
  }
  function area(b) { return (b.x1 - b.x0) * (b.y1 - b.y0); }

  // ---------- 가리기 ----------
  function applyMasks(g, scale) {
    S.findings.filter(f => f.selected).forEach(f => {
      const x = Math.floor(f.box.x0 * scale), y = Math.floor(f.box.y0 * scale);
      const w = Math.ceil((f.box.x1 - f.box.x0) * scale), h = Math.ceil((f.box.y1 - f.box.y0) * scale);
      if (w < 1 || h < 1) return;
      if (S.style === 'bar') {
        g.fillStyle = '#111'; g.fillRect(x, y, w, h);
      } else if (S.style === 'blur') {
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        g.filter = `blur(${Math.max(8, Math.min(w, h) / 4)}px)`;
        g.drawImage(g.canvas, x - 40, y - 40, w + 80, h + 80, x - 40, y - 40, w + 80, h + 80);
        g.filter = 'none';
        // 흐리게만 하면 글자가 비칠 수 있어 한 번 더 덮는다
        g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, y, w, h);
        g.restore();
      } else {
        const cell = Math.max(8, Math.round(Math.max(w, h) / 10));
        const sw = Math.max(1, Math.round(w / cell)), sh = Math.max(1, Math.round(h / cell));
        const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
        const tg = tmp.getContext('2d');
        tg.imageSmoothingEnabled = true;
        tg.drawImage(g.canvas, x, y, w, h, 0, 0, sw, sh);
        g.save(); g.imageSmoothingEnabled = false;
        g.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
        g.restore();
      }
    });
  }

  async function save() {
    // 원본 크기로 다시 그린 뒤 가린다. 캔버스로 다시 저장하면 EXIF(위치·기기 정보)는 남지 않는다.
    const out = document.createElement('canvas');
    out.width = S.W; out.height = S.H;
    const g = out.getContext('2d');
    g.drawImage(S.img, 0, 0);
    applyMasks(g, 1 / S.k);
    const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.92));
    S.lastBlob = blob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '올리기전에_가린사진.jpg';
    document.body.appendChild(a); a.click(); a.remove();
    $('#resultImg').src = url;
    $('#result').classList.remove('hidden');
    // 저장한 파일을 다시 열어 위치 정보가 정말 없는지 확인
    let gpsLeft = null;
    try { gpsLeft = await exifr.gps(await blob.arrayBuffer()); } catch (e) { gpsLeft = null; }
    const masked = S.findings.filter(f => f.selected).length;
    $('#okline').textContent = gpsLeft
      ? '⚠️ 위치 정보가 남아 있어요. 다시 시도해 주세요.'
      : `✓ ${masked}곳을 가렸어요 · ✓ 저장한 파일을 다시 열어 보니 위치·기기 정보가 없어요`;
    const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], 'photo.jpg', { type: 'image/jpeg' })] });
    $('#shareBtn').classList.toggle('hidden', !canShare);
    recordTest();
  }

  // ---------- F. 시험 모드: AI가 얼마나 맞았는지 사람이 고친 횟수로 잰다 ----------
  // AI가 찾은 곳 중 사람이 뺀 곳 = 잘못 찾은 것, 사람이 직접 더한 곳 = AI가 놓친 것.
  // 사진이 아니라 숫자만, 이 탭의 메모리에만 남긴다.
  function recordTest() {
    if (!S.test.on || !S.photoNo) return;
    const ai = S.findings.filter(f => f.ai);
    S.test.photos[S.photoNo] = {
      found: ai.length,
      wrong: ai.filter(f => !f.selected && f.touched).length,
      missed: S.findings.filter(f => f.type === 'manual').length,
    };
    renderTest();
  }
  function testSummary() {
    const ps = Object.values(S.test.photos);
    const sum = k => ps.reduce((a, p) => a + p[k], 0);
    const found = sum('found'), wrong = sum('wrong'), missed = sum('missed'), right = found - wrong;
    const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '-');
    return { n: ps.length, found, wrong, missed, right,
      precision: pct(right, found), recall: pct(right, right + missed) };
  }
  function renderTest() {
    const box = $('#testBox');
    if (!box) return;
    if (!S.test.on) { box.classList.add('hidden'); return; }
    const t = testSummary();
    box.classList.remove('hidden');
    $('#testTable').innerHTML = `<tr><td>시험한 사진</td><td>${t.n}장</td></tr>
      <tr><td>AI가 찾은 곳</td><td>${t.found}곳</td></tr>
      <tr><td>사람이 뺀 곳 (잘못 찾음)</td><td>${t.wrong}곳</td></tr>
      <tr><td>사람이 직접 더한 곳 (AI가 놓침)</td><td>${t.missed}곳</td></tr>
      <tr><th>맞게 찾은 비율</th><th>${t.precision}</th></tr>
      <tr><th>놓치지 않은 비율</th><th>${t.recall}</th></tr>`;
  }

  // ---------- C. 소리로 읽어 주기 ----------
  function speak() {
    if (!('speechSynthesis' in window) || !S.lastReport) { showMsg('이 브라우저는 읽어 주기를 지원하지 않아요.'); return; }
    speechSynthesis.cancel();
    const r = S.lastReport;
    const parts = [`${r.label}. 가릴 곳 ${S.findings.filter(f => f.selected).length}개를 찾았어요.`]
      .concat(r.cards.filter(c => c.level >= 1).slice(0, 4).map(c => c.title.replace(/[^\p{L}\p{N}\s.,·%']/gu, ' ')));
    const u = new SpeechSynthesisUtterance(parts.join(' '));
    u.lang = 'ko-KR'; u.rate = 1;
    speechSynthesis.speak(u);
  }

  // ---------- B. 어디에 올리는지 ----------
  function setContext(ctx) {
    S.context = ctx;
    [...document.querySelectorAll('#ctx button')].forEach(b => b.classList.toggle('on', b.dataset.v === ctx));
    if (S.findings.length && !S.busy) {
      Detect.applyContext(S.findings, ctx);
      renderAll();
    }
  }

  // ---------- E. 장면 판단 AI 준비 ----------
  let sceneReady = false;
  function loadScene() {
    if (!S.sceneOn || !window.Scene) return;
    Scene.load(t => { $('#sceneStatus').textContent = t; }).then(() => {
      sceneReady = true;
      $('#sceneStatus').textContent = '✓ 장면 판단 AI 준비 완료';
    }).catch(e => {
      console.error(e);
      $('#sceneStatus').textContent = '장면 판단 AI를 불러오지 못했어요 (글자·얼굴 찾기는 그대로 돼요)';
      S.sceneOn = false; $('#sceneToggle').checked = false;
    });
  }

  // ---------- D. 앱으로 설치 (PWA) ----------
  let installEvt = null;
  function setupPwa() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
    }
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) { $('#installBox').classList.add('hidden'); return; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (ios) $('#installHint').textContent = '아이폰: Safari 아래 공유 버튼(□↑) → "홈 화면에 추가"를 누르면 앱처럼 쓸 수 있어요.';
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); installEvt = e;
      $('#installBtn').classList.remove('hidden');
    });
    $('#installBtn').onclick = async () => {
      if (!installEvt) return;
      installEvt.prompt();
      await installEvt.userChoice.catch(() => {});
      installEvt = null; $('#installBtn').classList.add('hidden');
    };
  }

  // ---------- 카메라 ----------
  let stream = null;
  async function openCam() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      $('#camVideo').srcObject = stream;
      $('#cam').classList.remove('hidden');
    } catch (e) {
      showMsg('카메라를 열 수 없어요. "내 사진 넣기"로 사진을 골라 주세요. (폰에서는 "내 사진 넣기"를 누르면 카메라도 고를 수 있어요)');
    }
  }
  function closeCam() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    $('#cam').classList.add('hidden');
  }
  function snap() {
    const v = $('#camVideo'), c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const url = c.toDataURL('image/jpeg', 0.92);
    closeCam();
    loadFromDataUrl(url);
  }

  // ---------- 시작 ----------
  renderSamples();
  bindCanvas();
  $('#file').onchange = e => { const f = e.target.files[0]; if (f) loadFromFile(f); e.target.value = ''; };
  $('#camBtn').onclick = openCam;
  $('#camClose').onclick = closeCam;
  $('#snap').onclick = snap;
  $('#saveBtn').onclick = save;
  $('#shareBtn').onclick = async () => {
    if (!S.lastBlob) return;
    try { await navigator.share({ files: [new File([S.lastBlob], '올리기전에.jpg', { type: 'image/jpeg' })] }); } catch (e) { /* 취소 */ }
  };
  $('#style').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.style = b.dataset.v;
    [...$('#style').children].forEach(x => x.classList.toggle('on', x === b));
    S.preview = true; $('#previewToggle').checked = true;
    if (S.img) draw();
  });
  $('#previewToggle').onchange = e => { S.preview = e.target.checked; if (S.img) draw(); };
  $('#allOn').onclick = () => { S.findings.forEach(f => { f.selected = true; }); renderAll(); };
  $('#allOff').onclick = () => { S.findings.forEach(f => { f.selected = false; }); renderAll(); };
  $('#another').onclick = () => { $('#pick').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('#ctx').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setContext(b.dataset.v); });
  $('#speakBtn').onclick = speak;
  $('#bigBtn').onclick = () => {
    const on = document.body.classList.toggle('big');
    $('#bigBtn').setAttribute('aria-pressed', on);
  };
  $('#testToggle').onchange = e => { S.test.on = e.target.checked; renderTest(); };
  $('#testCopy').onclick = async () => {
    const t = testSummary();
    const txt = `올리기 전에 시험 결과: 사진 ${t.n}장, AI가 찾은 곳 ${t.found}곳, 잘못 찾음 ${t.wrong}곳, 놓침 ${t.missed}곳, 맞게 찾은 비율 ${t.precision}, 놓치지 않은 비율 ${t.recall}`;
    try { await navigator.clipboard.writeText(txt); $('#testCopy').textContent = '✓ 복사했어요'; } catch (e) { $('#testCopy').textContent = txt; }
  };
  $('#testReset').onclick = () => { S.test.photos = {}; renderTest(); };
  $('#sceneToggle').onchange = e => { S.sceneOn = e.target.checked; if (S.sceneOn) loadScene(); else $('#sceneStatus').textContent = '장면 판단 AI 꺼 둠'; };
  setupPwa();
  // 미리 모델을 받아 두면 첫 분석이 빨라진다
  setModel('AI 모델 준비 중… (처음 한 번만, 약 20MB)');
  setTimeout(() => {
    Promise.all([getOcrPool(), getFace()]).then(() => {
      // 준비가 끝난 순간부터 이 페이지가 바깥으로 보내는 요청을 센다
      readyAt = performance.now();
      setModel('✓ AI 준비 완료 · 이제 인터넷을 끊어도 분석돼요 (비행기 모드로 직접 확인해 보세요)', 'ok');
      renderNet();
      loadScene(); // 글자·얼굴 AI가 준비된 뒤에 장면 AI를 이어서 받는다
    }).catch(e => {
      console.error(e);
      setModel('AI 모델을 받지 못했어요. 인터넷 연결을 확인하고 새로 고침해 주세요.', 'err');
    });
  }, 300);
  window.addEventListener('online', renderNet);
  window.addEventListener('offline', renderNet);
  setInterval(renderNet, 2000);
  // 개발 확인용
  window.__olligi = S;
  window.__olligiDebug = { findBarcodes, adaptive };
})();
