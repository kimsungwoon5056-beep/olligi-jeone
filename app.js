// 올리기 전에 - 화면과 AI 모델 연결
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
  const WORK_MAX = 1600; // 분석용 긴 변 최대 길이
  const LEVEL_COLOR = { 3: '#d93a3a', 2: '#e07b00', 1: '#8a8f00' };

  const S = {
    img: null, buffer: null, W: 0, H: 0, k: 1, // k: 원본 → 분석 화면 배율
    work: document.createElement('canvas'),
    findings: [], gps: null, meta: null, qrFound: [], ocrText: '',
    style: 'mosaic', drag: null, busy: false, lastBlob: null,
  };

  // ---------- AI 모델 (처음 한 번만 받고 다시 씀) ----------
  let ocrP = null, faceP = null, ocrProgress = '';
  function getOcr() {
    if (!ocrP) {
      ocrP = Tesseract.createWorker('kor+eng', 1, {
        logger: m => {
          if (m.status && m.progress != null && !m.status.includes('recogniz')) {
            ocrProgress = `모델 받는 중 ${Math.round(m.progress * 100)}%`;
            setStep('ocr', ocrProgress);
          }
        },
      });
    }
    return ocrP;
  }
  function getFace() {
    if (!faceP) {
      faceP = (async () => {
        const v = await import(MP + '/vision_bundle.mjs');
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
  async function loadFromDataUrl(url) { start(await loadImage(url), dataUrlToBuffer(url)); }
  async function loadFromFile(file) {
    const buf = await file.arrayBuffer();
    const url = URL.createObjectURL(file);
    start(await loadImage(url), buf);
  }

  // ---------- 단계 표시와 시간 재기 ----------
  const STEPS = [
    ['meta', '숨은 정보 읽기 (위치·기기)'],
    ['ocr', '글자 읽기 (OCR)'],
    ['face', '얼굴 찾기'],
    ['qr', 'QR·바코드 찾기'],
    ['agent', '개인정보 판단·위험 설명'],
  ];
  let times = {};
  function resetSteps() {
    times = {};
    $('#steps').innerHTML = STEPS.map(([id, name]) => `<li id="st-${id}"><span>${name}</span><span class="st">기다리는 중</span></li>`).join('');
  }
  function setStep(id, text, done) {
    const li = $('#st-' + id);
    if (!li) return;
    const st = li.querySelector('.st');
    st.textContent = text;
    st.className = 'st' + (done ? ' done' : '');
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
    $('#device').textContent = `측정 기기: CPU 코어 ${navigator.hardwareConcurrency || '?'}개 · 사진 ${S.W}×${S.H} · 처음 실행에는 모델 받는 시간이 들어가요.`;
  }

  // ---------- 분석 ----------
  async function start(img, buffer) {
    if (S.busy) return;
    S.busy = true;
    S.img = img; S.buffer = buffer; S.W = img.naturalWidth; S.H = img.naturalHeight;
    S.k = Math.min(1, WORK_MAX / Math.max(S.W, S.H));
    S.work.width = Math.round(S.W * S.k); S.work.height = Math.round(S.H * S.k);
    S.work.getContext('2d').drawImage(img, 0, 0, S.work.width, S.work.height);
    S.findings = []; S.gps = null; S.meta = null; S.qrFound = []; S.ocrText = '';
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
    const ocr = await timed('ocr', async () => {
      const w = await getOcr();
      const passes = [
        [S.work, '6'], [adaptive(S.work, false), '6'], [adaptive(S.work, true), '6'], [S.work, '3'],
      ];
      const out = [];
      for (let i = 0; i < passes.length; i++) {
        setStep('ocr', `읽는 중 ${i + 1}/${passes.length}`);
        await w.setParameters({ tessedit_pageseg_mode: passes[i][1] });
        const { data } = await w.recognize(passes[i][0]);
        out.push(data);
      }
      return out;
    });
    const faces = await timed('face', async () => {
      const fd = await getFace();
      return fd.detect(S.work).detections || [];
    });
    let bars = [];
    const qr = await timed('qr', async () => {
      bars = findBarcodes(S.work);
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
      (faces || []).forEach(d => {
        const b = d.boundingBox;
        found.push({ type: 'face', text: `확신 ${Math.round((d.categories?.[0]?.score || 0) * 100)}%`,
          box: { x0: b.originX, y0: b.originY, x1: b.originX + b.width, y1: b.originY + b.height } });
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
      S.findings = found.map(f => ({ ...f, box: pad(f.box, f.type === 'face' ? 0.12 : 0.06), selected: true }));
    });

    renderAll();
    renderPerf();
    S.busy = false;
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
  function draw(previewMask) {
    const c = $('#view');
    c.width = S.work.width; c.height = S.work.height;
    const g = c.getContext('2d');
    g.drawImage(S.work, 0, 0);
    if (previewMask) applyMasks(g, 1);
    const lw = Math.max(2, c.width / 400);
    S.findings.forEach((f, i) => {
      const b = f.box, lv = Detect.TYPES[f.type].level;
      g.lineWidth = lw * (f.selected ? 1.5 : 1);
      g.strokeStyle = f.selected ? (LEVEL_COLOR[lv] || '#d93a3a') : '#9aa1b3';
      g.setLineDash(f.selected ? [] : [lw * 4, lw * 3]);
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.setLineDash([]);
      const tag = `${i + 1} ${Detect.TYPES[f.type].label}`;
      g.font = `bold ${Math.max(14, c.width / 60)}px "Malgun Gothic", sans-serif`;
      const tw = g.measureText(tag).width + 10, th = Math.max(18, c.width / 48);
      const ty = b.y0 - th < 0 ? b.y1 : b.y0 - th;
      g.fillStyle = f.selected ? (LEVEL_COLOR[lv] || '#d93a3a') : '#9aa1b3';
      g.fillRect(b.x0, ty, tw, th);
      g.fillStyle = '#fff';
      g.fillText(tag, b.x0 + 5, ty + th * 0.78);
    });
    if (S.drag && S.drag.box) {
      const b = S.drag.box;
      g.lineWidth = lw; g.strokeStyle = '#3a5bd9'; g.setLineDash([lw * 3, lw * 2]);
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); g.setLineDash([]);
    }
  }

  function renderAll() {
    draw();
    const rep = Detect.buildReport(S.findings, { gps: S.gps, meta: S.meta, qrFound: S.qrFound });
    const n = S.findings.filter(f => f.selected).length + (S.gps ? 1 : 0);
    $('#banner').className = 'banner l' + rep.level;
    $('#banner').textContent = `${rep.label} · 가릴 곳 ${S.findings.filter(f => f.selected).length}개${S.gps ? ' + 숨은 위치 정보' : ''}`;
    $('#risks').innerHTML = '<div class="hint" style="margin:0 0 4px">🤖 AI가 판단한 "이 사진으로 남이 알 수 있는 것"</div>' +
      rep.cards.map(c => `<div class="risk l${c.level}"><b>${esc(c.title)}</b><p>${esc(c.body)}</p></div>`).join('');
    $('#report').classList.remove('hidden');

    const list = $('#finds');
    list.innerHTML = '';
    S.findings.forEach((f, i) => {
      const t = Detect.TYPES[f.type];
      const li = document.createElement('li');
      li.innerHTML = `<input type="checkbox" ${f.selected ? 'checked' : ''} aria-label="${t.label} 가리기">
        <div><span class="kind">${i + 1}. ${t.label}</span><span class="pill l${t.level}">${['', '낮음', '중간', '높음'][t.level]}</span>
        ${f.text ? ` <span class="val">${esc(f.text)}</span>` : ''}
        <span class="why">${esc(f.note ? f.note + '. ' + t.why : t.why)}</span></div>`;
      li.querySelector('input').onchange = e => { f.selected = e.target.checked; renderAll(); };
      list.appendChild(li);
    });
    if (S.gps) {
      const li = document.createElement('li');
      li.innerHTML = `<input type="checkbox" checked disabled><div><span class="kind">숨은 위치 정보 (GPS)</span><span class="pill l3">높음</span>
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
        if (hit) hit.selected = !hit.selected;
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
  }

  // ---------- 카메라 ----------
  let stream = null;
  async function openCam() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      $('#camVideo').srcObject = stream;
      $('#cam').classList.remove('hidden');
    } catch (e) {
      alert('카메라를 열 수 없어요. "내 사진 넣기"로 사진을 골라 주세요.');
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
    if (S.img) draw(true);
  });
  // 미리 모델을 받아 두면 첫 분석이 빨라진다
  setTimeout(() => { getOcr().catch(() => {}); getFace().catch(() => {}); }, 800);
  // 개발 확인용
  window.__olligi = S;
  window.__olligiDebug = { findBarcodes, adaptive };
})();
