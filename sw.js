// 올리기 전에 - 오프라인용 서비스 워커
// 앱과 AI 모델 파일을 이 기기에 보관해서, 한 번 연 뒤에는 인터넷 없이도 돌게 한다.
// 이 서비스 워커는 같은 사이트의 파일을 '받아 두기'만 하고, 어디로도 보내지 않는다.
const VER = 'olligi-v10';
const SHELL = ['./', 'index.html', 'app.js', 'detect.js', 'scene.js', 'hero.js', 'samples.js', 'manifest.webmanifest'];
const CORE = [
  'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
  'vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract-core/tesseract-core-lstm.wasm.js',
  'vendor/lang/kor.traineddata.gz', 'vendor/lang/eng.traineddata.gz',
  'vendor/mediapipe/vision_bundle.js', 'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/blaze_face_short_range.tflite',
  'vendor/misc/jsQR.min.js', 'vendor/misc/exifr-lite.umd.js', 'vendor/ort/ort.wasm.min.js',
  'vendor/fonts/BlackHanSans-Regular.woff2', 'vendor/fonts/IBMPlexSansKR-Regular.woff2', 'vendor/fonts/IBMPlexSansKR-SemiBold.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll([...SHELL, ...CORE].map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isVendor = url.pathname.includes('/vendor/') || url.pathname.includes('/icons/');
  if (isVendor) {
    // 모델·라이브러리: 보관본 먼저 (버전이 고정이라 바뀌지 않는다). 장면 AI 파일은 처음 쓸 때 보관된다.
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VER).then(c => c.put(e.request, copy)); }
      return res;
    })));
  } else {
    // 앱 화면 파일: 인터넷이 되면 새 버전, 안 되면 보관본
    // cache: 'no-cache' = 브라우저 캐시에 오래된 파일이 있어도 서버에 새 버전이 있는지 꼭 확인
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VER).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
  }
});
