// 올리기 전에 - 첫 화면 시연
// "이 사진 한 장으로 낯선 사람이 알 수 있는 것"을 보여 주고, 버튼을 누르면 하나씩 가려서 "알 수 없어요"로 바꾼다.
// 상자 위치는 실제 앱이 이 예시 사진을 분석한 결과(tools/shot/dump.js)를 그대로 옮겨 왔다.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const ROWS = [
    { key: 'name', label: '이름', value: '김하늘', boxes: [[31.5, 33.6, 8.5, 4.5]] },
    { key: 'phone', label: '연락처', value: '010-2847-1936', boxes: [[20.8, 38.8, 21.5, 5.7]] },
    { key: 'home', label: '사는 곳', value: '전주시 덕진구 가상로 123, 101동 1203호', boxes: [[20.0, 43.0, 38.8, 10.1], [21.3, 49.4, 17.1, 7.1]] },
    { key: 'parcel', label: '택배 조회', value: '운송장 6123-4567-8901, QR·바코드로 받는 사람까지', boxes: [[34.4, 25.3, 19.3, 5.1], [63.3, 60.0, 13.9, 18.6], [19.2, 67.2, 39.2, 15.6], [31.1, 58.4, 8.7, 3.7]] },
    { key: 'gps', label: '찍은 곳', value: '위도 35.8242, 경도 127.1480 (사진 파일 속)', chip: true },
    { key: 'device', label: '찍은 때', value: '2026년 11월 9일 오후 2시 21분, SamplePhone', chip: true },
  ];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function build() {
    const fig = $('#heroPhoto'), list = $('#heroFacts');
    if (!fig || !list || !window.SAMPLES) return;
    fig.querySelector('img').src = window.SAMPLES[0].src;
    ROWS.forEach((r, i) => {
      (r.boxes || []).forEach(([x, y, w, h]) => {
        const b = document.createElement('span');
        b.className = 'hbox'; b.dataset.row = i;
        b.style.cssText = `left:${x}%;top:${y}%;width:${w}%;height:${h}%`;
        fig.appendChild(b);
      });
      const li = document.createElement('li');
      li.dataset.row = i;
      li.innerHTML = `<span class="k">${r.label}</span><span class="v"><span class="was">${r.value}</span><span class="now">알 수 없어요</span></span>`;
      li.addEventListener('mouseenter', () => fig.dataset.hot = i);
      li.addEventListener('mouseleave', () => delete fig.dataset.hot);
      list.appendChild(li);
    });
    // 같은 행의 첫 상자에만 번호를 붙인다
    ROWS.forEach((r, i) => {
      const first = fig.querySelector(`.hbox[data-row="${i}"]`);
      if (first) first.dataset.no = i + 1;
      list.children[i].querySelector('.k').dataset.no = r.chip ? '' : i + 1;
    });
    $('#heroGo').addEventListener('click', play);
    $('#heroAgain').addEventListener('click', reset);
  }

  let timers = [];
  function play() {
    const go = $('#heroGo');
    if (go.dataset.done) { $('#pick').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); return; }
    go.disabled = true;
    const step = reduce ? 0 : 420;
    ROWS.forEach((r, i) => {
      timers.push(setTimeout(() => {
        document.querySelectorAll(`#heroPhoto .hbox[data-row="${i}"]`).forEach(b => b.classList.add('taped'));
        if (r.chip) $('#heroChip').classList.add('gone');
        $('#heroFacts').children[i].classList.add('gone');
      }, 150 + step * i));
    });
    timers.push(setTimeout(() => {
      $('#heroSummary').textContent = '이제 이 사진으로 알 수 있는 개인정보가 없어요. 숨은 위치 정보도 지웠어요.';
      go.disabled = false; go.dataset.done = '1'; go.textContent = '내 사진으로 해 보기';
      $('#heroAgain').classList.remove('hidden');
    }, 250 + step * ROWS.length));
  }
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    document.querySelectorAll('#heroPhoto .hbox').forEach(b => b.classList.remove('taped'));
    document.querySelectorAll('#heroFacts li').forEach(li => li.classList.remove('gone'));
    $('#heroChip').classList.remove('gone');
    const go = $('#heroGo'); delete go.dataset.done; go.disabled = false; go.textContent = '올리기 전에 가리기';
    $('#heroSummary').textContent = '';
    $('#heroAgain').classList.add('hidden');
  }

  build();
})();
