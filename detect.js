// 올리기 전에 - 개인정보 판별 에이전트
// OCR이 읽은 글자 줄(lines)을 받아 어떤 개인정보인지 판단하고,
// 찾은 것들을 합쳐 "이 사진으로 남이 알 수 있는 것"을 설명한다.
// 브라우저(window.Detect)와 Node(module.exports) 양쪽에서 쓸 수 있다.
(function (root) {
  'use strict';

  // level: 3 높음, 2 중간, 1 낮음
  const TYPES = {
    rrn:      { label: '주민등록번호', level: 3, why: '명의 도용이나 대출 사기에 쓰일 수 있어요.' },
    card:     { label: '카드번호', level: 3, why: '카드번호는 온라인 결제 도용에 쓰일 수 있어요. (번호 검증 공식으로 진짜 카드 형식인지 확인했어요)' },
    license:  { label: '운전면허번호', level: 3, why: '신분증 번호라 명의 도용에 쓰일 수 있어요.' },
    passport: { label: '여권번호', level: 3, why: '신분증 번호라 명의 도용에 쓰일 수 있어요.' },
    password: { label: '비밀번호', level: 3, why: '비밀번호가 보이면 계정이나 문을 바로 열 수 있어요.' },
    address:  { label: '주소', level: 3, why: '집을 그대로 찾아올 수 있어요.' },
    child:    { label: '학년·반·이름', level: 3, why: '낯선 사람이 아이 이름을 부르며 다가올 수 있어요.' },
    phone:    { label: '전화번호', level: 2, why: '스팸 전화나 스미싱 문자를 받을 수 있어요.' },
    tracking: { label: '운송장 번호', level: 2, why: '택배 조회로 이름과 주소를 다시 알아낼 수 있어요.' },
    account:  { label: '계좌번호', level: 2, why: '지인인 척 돈을 보내 달라는 사기에 쓰일 수 있어요.' },
    plate:    { label: '차 번호판', level: 2, why: '차 번호로 차 주인을 특정할 수 있어요.' },
    apt:      { label: '동·호수', level: 2, why: '사는 건물과 집 호수가 드러나요.' },
    school:   { label: '학교 이름', level: 2, why: '아이가 다니는 학교를 알 수 있어요.' },
    face:     { label: '얼굴', level: 2, why: '다른 사람 얼굴은 허락 없이 올리면 초상권 문제가 생길 수 있어요.' },
    qr:       { label: 'QR 코드', level: 2, why: 'QR 안에 주문 정보나 주소가 들어 있을 수 있어요.' },
    qrplain:  { label: 'QR 코드', level: 1, why: 'QR 안에서 개인정보는 찾지 못했어요. 내 계정이나 결제 링크일 수 있으니 필요 없으면 가리세요.' },
    barcode:  { label: '바코드', level: 2, why: '송장 바코드에는 운송장 번호가 들어 있어요. 찍어서 조회할 수 있어요.' },
    name:     { label: '이름', level: 1, why: '다른 정보와 합쳐지면 누구인지 알 수 있어요.' },
    email:    { label: '이메일', level: 1, why: '스팸이나 피싱 메일을 받을 수 있어요.' },
    manual:   { label: '직접 고른 곳', level: 1, why: '내가 직접 가리기로 한 곳이에요.' },
  };

  // 어디에 올리는지에 따라 '그대로 둬도 되는 것'이 달라진다.
  // keep: 이 상황에서는 기본으로 가리지 않는 종류. 주민번호·카드·비밀번호·위치 같은 것은 어디서나 가린다.
  const CONTEXTS = {
    market: { label: '중고거래', icon: '🛒', keep: [],
      note: '모르는 사람이 보는 곳이라 찾은 것을 모두 가렸어요. 판매 글은 거래가 끝나도 오래 남아요.' },
    sns: { label: 'SNS 공개', icon: '🌐', keep: [],
      note: '누구나 보고 저장할 수 있는 곳이라 찾은 것을 모두 가렸어요.' },
    group: { label: '지인 단체방', icon: '👥', keep: ['name', 'face'],
      note: '아는 사람끼리라 이름·얼굴은 그대로 두었어요. 단체방 캡처는 밖으로 퍼지기 쉬워서 번호·주소는 가렸어요.' },
    family: { label: '가족방', icon: '🏠', keep: ['name', 'face', 'child', 'school', 'phone', 'apt', 'address', 'plate', 'tracking', 'qr', 'qrplain', 'barcode'],
      note: '가족끼리라 이름·주소·전화번호는 그대로 두었어요. 그래도 주민번호·카드·계좌·비밀번호는 가렸어요. 캡처가 밖으로 나갈 수 있으니까요.' },
  };
  function applyContext(findings, ctx) {
    const c = CONTEXTS[ctx] || CONTEXTS.market;
    findings.forEach(f => { if (f.type !== 'manual') f.selected = !c.keep.includes(f.type); });
    return findings;
  }

  const BANK =/(국민|신한|농협|우리|하나|기업|카카오|토스|새마을|우체국|수협|씨티|SC|케이뱅크|부산|대구|광주|경남|전북|제주|은행|계좌|입금|예금주)/;
  const PLATE_CH = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육공해국합';
  const RE = {
    rrn: /(?<!\d)\d{6}-?[1-8]\d{6}(?!\d)/g, // 주민등록번호와 외국인등록번호(5~8)
    card: /(?<!\d)\d{4}-?\d{4}-?\d{4}-?\d{4}(?!\d)/g,
    license: /(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)/g,
    passport: /[MSRODG]\d{8}|[MSRODG]\d{3}[A-Z]\d{4}/g,
    password: /(비밀번호|비번|패스워드|암호|PW|pw|Pw|password|PASSWORD)[:：=]?([^\s가-힣]{4,}|\d{4,})/g,
    phone: /(?<!\d)((01[016789]-?\d{3,4}-?\d{4})|(0(2|[3-6][1-5])-\d{3,4}-\d{4}))(?!\d)/g,
    digits3: /\d{2,6}-\d{2,6}-\d{2,7}/g,
    plate: new RegExp('\\d{2,3}[' + PLATE_CH + ']\\d{4}', 'g'),
    apt: /\d{1,4}동(\d{1,4}호)?|\d{3,4}호/g,
    roadAddr: /[가-힣0-9]+(로|길)\d+(-\d+)?/,
    region: /(특별시|광역시|특별자치|[가-힣]+(시|군|구|읍|면)|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/,
    school: /[가-힣]{1,12}(초등학교|중학교|고등학교|유치원|어린이집|대학교)/g,
    child: /\d학년\d{1,2}반([가-힣]{2,4})?/g,
    labeledName: /(받는분|받는사람|수령인|수취인|성명|이름|예금주|보내는분|고객명)[:：]?([가-힣]{2,5})/g,
    email: /[\w.+-]+@[\w-]+\.[\w.]+/g,
  };

  // 카드번호 검증 공식(Luhn). 아무 16자리 숫자를 카드로 잘못 보지 않게 한다.
  function luhn(s) {
    const d = s.replace(/\D/g, '');
    if (d.length < 13) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function unionBox(boxes) {
    return boxes.reduce((a, b) => ({
      x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
    }));
  }

  // lines: [{ words: [{ text, bbox:{x0,y0,x1,y1} }] }]
  function analyzeLines(lines) {
    const out = [];
    for (const line of lines) {
      const words = (line.words || []).filter(w => w.text && w.text.trim());
      if (!words.length) continue;
      let compact = '';
      const map = [];
      words.forEach((w, i) => {
        for (const ch of w.text.replace(/\s+/g, '')) { compact += ch; map.push(i); }
      });
      // OCR이 숫자 0·1을 O·l로 잘못 읽는 경우를 바로잡는다 (글자 수는 그대로)
      compact = compact
        .replace(/[Oo〇](?=[\d-])|(?<=[\d-])[Oo〇]/g, '0')
        .replace(/[lI|](?=[\d-])|(?<=[\d-])[lI|]/g, '1')
        .replace(/[—–~]/g, '-');
      const used = new Array(compact.length).fill(false);

      const add = (type, s, e, opt = {}) => {
        if (e <= s) return false;
        if (!opt.overlap) { for (let k = s; k < e; k++) if (used[k]) return false; }
        for (let k = s; k < e; k++) used[k] = true;
        const idx = [...new Set(map.slice(s, e))];
        const box = unionBox(idx.map(i => words[i].bbox));
        out.push({ type, text: compact.slice(s, e), box, ...opt.extra });
        return true;
      };
      const run = (type, re, pick) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(compact))) {
          let s = m.index, e = s + m[0].length;
          if (pick) { const r = pick(m); if (!r) continue; [s, e] = r; }
          add(type, s, e);
          if (m[0].length === 0) re.lastIndex++;
        }
      };

      // 1) 신분증·카드·비밀번호, 주민등록번호, 전화번호 (가장 확실한 것부터)
      run('card', RE.card, mm => (luhn(mm[0]) ? [mm.index, mm.index + mm[0].length] : null));
      run('license', RE.license);
      run('passport', RE.passport, mm => (/(여권|PASSPORT|Passport|passport)/.test(compact) || /^[MSRODG]\d{3}[A-Z]/.test(mm[0])
        ? [mm.index, mm.index + mm[0].length] : null));
      run('password', RE.password, mm => {
        const s = mm.index + mm[0].length - mm[2].length;
        return [s, s + mm[2].length];
      });
      run('rrn', RE.rrn);
      run('phone', RE.phone);
      // 2) 숫자-숫자-숫자: 운송장 / 계좌
      const isTracking = /(운송장|송장|택배)/.test(compact);
      const isBank = BANK.test(compact);
      RE.digits3.lastIndex = 0;
      let m;
      while ((m = RE.digits3.exec(compact))) {
        const s = m.index, e = s + m[0].length;
        if (isTracking) add('tracking', s, e);
        else if (isBank) {
          if (add('account', s, e)) {
            // 계좌 바로 뒤에 오는 2~4글자 한글은 예금주 이름으로 본다
            const tail = compact.slice(e).match(/^([가-힣]{2,4})/);
            if (tail) add('name', e, e + tail[1].length);
          }
        } else add('account', s, e, { extra: { note: '계좌번호나 회원번호일 수 있어요' } });
      }
      // 3) 차 번호판
      run('plate', RE.plate);
      // 4) 주소 (도로명 + 지역 이름이 같이 있으면 줄 전체를 주소로)
      if (RE.roadAddr.test(compact) && RE.region.test(compact)) {
        add('address', 0, compact.length, { overlap: true });
      }
      // 5) 동·호수
      run('apt', RE.apt, mm => {
        // '동아리'처럼 숫자 없이 '동'이 쓰인 경우는 정규식에서 이미 빠진다
        return [mm.index, mm.index + mm[0].length];
      });
      // 6) 학교, 학년·반·이름
      run('school', RE.school);
      run('child', RE.child);
      // 7) '받는분 홍길동' 같은 이름
      run('name', RE.labeledName, mm => {
        const s = mm.index + mm[0].length - mm[2].length;
        return [s, s + mm[2].length];
      });
      run('email', RE.email);
    }
    return out;
  }

  // QR 안의 글자에서 어떤 개인정보가 들어 있는지 이름만 뽑는다
  function scanPlainText(text) {
    const compact = (text || '').replace(/\s+/g, '');
    const found = [];
    const test = (re) => { re.lastIndex = 0; return re.test(compact); };
    if (test(RE.rrn)) found.push('주민등록번호');
    if (test(RE.phone)) found.push('전화번호');
    if (RE.roadAddr.test(compact) || test(RE.apt)) found.push('주소');
    if (test(RE.digits3)) found.push('운송장·계좌 번호');
    if (/(받는분|수령인|[가-힣]{2,4}\|)/.test(text || '')) found.push('이름');
    return found;
  }

  function fmtCoord(v) { return (Math.round(v * 10000) / 10000).toFixed(4); }

  // 찾은 것들을 합쳐서 '남이 알 수 있는 것'을 문장으로 설명한다
  function buildReport(findings, extra = {}) {
    const on = findings.filter(f => f.selected !== false && f.type !== 'manual');
    const has = t => on.some(f => f.type === t);
    const count = t => on.filter(f => f.type === t).length;
    const cards = [];
    const livesAt = has('address') || has('apt');
    const who = has('name') || has('child');

    if (livesAt && who && has('phone')) {
      cards.push({ level: 3, title: '누가, 어디 사는지, 연락처까지 다 드러나요',
        body: '이름·전화번호·주소가 한 장에 모두 있어요. 모르는 사람이 집에 찾아오거나, 택배 기사인 척 연락해 올 수 있어요.' });
    } else if (livesAt && !(has('plate') && has('apt') && !has('address'))) {
      cards.push({ level: has('address') ? 3 : 2, title: '사는 곳이 드러나요',
        body: has('address') ? '주소가 그대로 보여요. 집을 바로 찾아올 수 있어요.' : '아파트 동·호수가 보여요. 사진 배경과 합치면 어디 사는지 짐작할 수 있어요.' });
    }
    if (has('plate')) {
      cards.push(has('apt')
        ? { level: 3, title: '이 차의 주인이 몇 동에 사는지 알 수 있어요', body: '번호판과 아파트 동 번호가 함께 보여요. 차를 보고 주인을 찾아갈 수 있어요.' }
        : { level: 2, title: '차 번호가 보여요', body: '번호판으로 차 주인을 특정하거나, 사는 곳을 짐작할 수 있어요.' });
    }
    if (has('child') || has('school')) {
      cards.push({ level: 3, title: '아이의 학교와 이름을 알 수 있어요',
        body: '학교·학년·반·이름이 보여요. 낯선 사람이 이름을 부르며 다가오면 아이는 아는 사람이라고 믿기 쉬워요.' });
    }
    if (has('rrn')) {
      cards.push({ level: 3, title: '주민등록번호가 보여요', body: '명의 도용에 쓰일 수 있어요. 어떤 경우에도 그대로 올리지 마세요.' });
    }
    if (has('card') || has('license') || has('passport')) {
      const what = [has('card') && '카드번호', has('license') && '운전면허번호', has('passport') && '여권번호'].filter(Boolean).join('·');
      cards.push({ level: 3, title: `${what}가 보여요`, body: '신분증·카드 번호는 결제 도용이나 명의 도용에 바로 쓰일 수 있어요. 지갑이나 서류가 함께 찍히지 않았는지 꼭 확인하세요.' });
    }
    if (has('password')) {
      cards.push({ level: 3, title: '비밀번호가 보여요', body: '메모나 캡처 속 비밀번호는 계정이나 현관문을 바로 여는 열쇠예요.' });
    }
    if (has('account')) {
      cards.push({ level: 2, title: '계좌번호가 보여요', body: '계좌번호와 예금주 이름으로 지인인 척 돈을 보내 달라는 사기를 칠 수 있어요.' });
    }
    if (has('qrplain') && !has('tracking') && !has('barcode') && !has('qr')) {
      cards.push({ level: 1, title: 'QR 코드가 보여요', body: 'QR 안에서 개인정보는 찾지 못했어요. 다만 내 프로필·결제 링크라면 낯선 사람이 찍어서 열어 볼 수 있어요.' });
    }
    if (has('tracking') || has('qr') || has('barcode')) {
      const inQr = (extra.qrFound || []).length ? ` QR을 읽어 보니 ${extra.qrFound.join('·')}까지 들어 있어요.` : '';
      cards.push({ level: 2, title: '택배 정보를 다시 조회할 수 있어요', body: '운송장 번호, 바코드, QR로 이름과 주소를 알아낼 수 있어요.' + inQr });
    }
    if (has('phone') && !(livesAt && who)) {
      cards.push({ level: 2, title: `전화번호 ${count('phone')}개가 보여요`, body: '스팸 전화나 스미싱 문자의 대상이 될 수 있어요.' });
    }
    if (has('face')) {
      cards.push({ level: 2, title: `얼굴 ${count('face')}개가 보여요`, body: '내 얼굴이 아니라면 그 사람의 허락을 받거나 가려 주세요.' });
    }
    if (extra.gps) {
      cards.push({ level: 3, title: '사진 파일 속에 찍은 위치가 숨어 있어요',
        body: `위도 ${fmtCoord(extra.gps.latitude)}, 경도 ${fmtCoord(extra.gps.longitude)}. 눈에는 안 보이지만 파일을 받은 사람은 지도에서 이 위치를 볼 수 있어요. 집에서 찍었다면 집 위치예요. 저장할 때 자동으로 지워요.` });
    }
    if (extra.meta) {
      cards.push({ level: 1, title: '촬영 기기와 시각 정보도 들어 있어요', body: `${extra.meta}. 저장할 때 함께 지워요.` });
    }
    // 장면 판단 AI: 사진 전체를 보고 "신분증 같아요"처럼 글자로는 못 잡는 위험을 알려 준다
    if (extra.scene && extra.scene.length) {
      const top = extra.scene[0];
      if (top.level > 0 && top.p >= 0.5) {
        const extraNote = on.length ? '' : ' 글자로는 찾은 것이 없으니, 사진을 한 번 더 직접 살펴보세요.';
        cards.push({ level: top.level, title: `장면 AI가 보기에 '${top.ko}' 같아요 (확신 ${Math.round(top.p * 100)}%)`, body: top.msg + extraNote });
      }
    }
    if (extra.context && CONTEXTS[extra.context]) {
      const c = CONTEXTS[extra.context];
      const kept = findings.filter(f => f.type !== 'manual' && f.selected === false).length;
      cards.push({ level: -1, title: `${c.label}에 올린다고 보고 판단했어요`, body: c.note + (kept ? ` (그대로 둔 곳 ${kept}개)` : '') });
    }
    if (!cards.filter(c => c.level >= 0).length) {
      cards.push({ level: 0, title: '눈에 띄는 개인정보를 찾지 못했어요',
        body: '그래도 올리기 전에 한 번 더 살펴보세요. 놓친 곳은 사진 위를 끌어서 직접 가릴 수 있어요.' });
    }
    cards.sort((a, b) => (a.level === -1) - (b.level === -1) || b.level - a.level);
    const top = Math.max(0, ...cards.map(c => c.level));
    const label = top >= 3 ? '위험 높음' : top === 2 ? '위험 중간' : '위험 낮음';
    return { level: top, label, cards };
  }

  const api = { TYPES, CONTEXTS, applyContext, analyzeLines, scanPlainText, buildReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detect = api;
})(typeof window !== 'undefined' ? window : globalThis);
