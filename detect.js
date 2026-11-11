// 올리기 전에 - 개인정보 판별 에이전트
// OCR이 읽은 글자 줄(lines)을 받아 어떤 개인정보인지 판단하고,
// 찾은 것들을 합쳐 "이 사진으로 남이 알 수 있는 것"을 설명한다.
// 브라우저(window.Detect)와 Node(module.exports) 양쪽에서 쓸 수 있다.
(function (root) {
  'use strict';

  // level: 3 높음, 2 중간, 1 낮음
  const TYPES = {
    rrn:      { label: '주민등록번호', level: 3, why: '명의 도용이나 대출 사기에 쓰일 수 있어요.', rule: '앞 6자리가 있을 수 있는 생년월일이고, 뒤 7자리 첫 숫자가 1~8이에요. 하이픈이 있거나 "주민·등록번호" 같은 말이 함께 있어요' },
    card:     { label: '카드번호', level: 3, why: '카드번호는 온라인 결제 도용에 쓰일 수 있어요. (번호 검증 공식으로 진짜 카드 형식인지 확인했어요)', rule: '16자리이고 카드번호 검증 공식(Luhn)을 통과했어요. 4자리씩 끊겼거나 "카드"라는 말이 함께 있어요' },
    license:  { label: '운전면허번호', level: 3, why: '신분증 번호라 명의 도용에 쓰일 수 있어요.', rule: '00-00-000000-00 운전면허번호 형식이에요' },
    passport: { label: '여권번호', level: 3, why: '신분증 번호라 명의 도용에 쓰일 수 있어요.', rule: '영문 1자 + 숫자로 된 여권번호 형식이고, "여권"이라는 말이 함께 있거나 새 여권 형식이에요' },
    password: { label: '비밀번호', level: 3, why: '비밀번호가 보이면 계정이나 문을 바로 열 수 있어요.', rule: '"비밀번호·비번·PW" 같은 말 바로 뒤에 붙은 4자 이상 글자예요' },
    address:  { label: '주소', level: 3, why: '집을 그대로 찾아올 수 있어요.', rule: '시·도나 ○○시·구 다음에 "○○로·길 + 번호"가 와요' },
    child:    { label: '학년·반·이름', level: 3, why: '낯선 사람이 아이 이름을 부르며 다가올 수 있어요.', rule: '"○학년 ○반" 뒤에 이름이 와요' },
    phone:    { label: '전화번호', level: 2, why: '스팸 전화나 스미싱 문자를 받을 수 있어요.', rule: '010 같은 휴대전화 번호나 지역번호 형식이에요' },
    tracking: { label: '운송장 번호', level: 2, why: '택배 조회로 이름과 주소를 다시 알아낼 수 있어요.', rule: '같은 줄에 "운송장·송장·택배"가 있는 9자리 이상 숫자 묶음이에요' },
    account:  { label: '계좌번호', level: 2, why: '지인인 척 돈을 보내 달라는 사기에 쓰일 수 있어요.', rule: '같은 줄에 은행 이름이나 "계좌·입금·예금주" 같은 말이 있는 9자리 이상 숫자 묶음이에요' },
    plate:    { label: '차 번호판', level: 2, why: '차 번호로 차 주인을 특정할 수 있어요.', rule: '숫자 2~3자리 + 한글 1자 + 숫자 4자리, 번호판 형식이에요' },
    apt:      { label: '동·호수', level: 2, why: '사는 건물과 집 호수가 드러나요.', rule: '숫자 뒤에 "동"이 붙었거나, 3~4자리 숫자 뒤에 "호"가 붙었어요' },
    school:   { label: '학교 이름', level: 2, why: '아이가 다니는 학교를 알 수 있어요.', rule: '"○○초등학교·중학교·고등학교·대학교·유치원·어린이집" 이름이에요' },
    face:     { label: '얼굴', level: 2, why: '다른 사람 얼굴은 허락 없이 올리면 초상권 문제가 생길 수 있어요.', rule: '얼굴 찾기 신경망(BlazeFace)이 얼굴로 봤어요' },
    qr:       { label: 'QR 코드', level: 2, why: 'QR 안에 주문 정보나 주소가 들어 있을 수 있어요.', rule: 'QR을 읽어 안에 든 글자에서 개인정보 형식을 찾았어요' },
    qrplain:  { label: 'QR 코드', level: 1, why: 'QR 안에서 개인정보는 찾지 못했어요. 내 계정이나 결제 링크일 수 있으니 필요 없으면 가리세요.', rule: 'QR을 읽었지만 안에서 개인정보 형식은 못 찾았어요' },
    barcode:  { label: '바코드', level: 2, why: '송장 바코드에는 운송장 번호가 들어 있어요. 찍어서 조회할 수 있어요.', rule: '가로로 긴 세로 줄무늬 묶음, 바코드 모양을 찾았어요' },
    name:     { label: '이름', level: 1, why: '다른 정보와 합쳐지면 누구인지 알 수 있어요.', rule: '"받는분·이름·예금주" 같은 말 바로 뒤나 계좌번호 바로 뒤에 온 2~5글자예요' },
    email:    { label: '이메일', level: 1, why: '스팸이나 피싱 메일을 받을 수 있어요.', rule: '@가 들어간 이메일 주소 형식이에요' },
    number:   { label: '번호', level: 1, why: '계좌·회원·주문 번호일 수 있어요. 무슨 번호인지 확인하고 필요하면 가리세요.', rule: '9자리 이상 숫자 묶음인데, 무슨 번호인지 알려 주는 말이 같은 줄에 없어요' },
    manual:   { label: '직접 고른 곳', level: 1, why: '내가 직접 가리기로 한 곳이에요.', rule: '내가 직접 그린 곳이에요' },
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
    family: { label: '가족방', icon: '🏠', keep: ['name', 'face', 'child', 'school', 'phone', 'apt', 'address', 'plate', 'tracking', 'qr', 'qrplain', 'barcode', 'number'],
      note: '가족끼리라 이름·주소·전화번호는 그대로 두었어요. 그래도 주민번호·카드·계좌·비밀번호는 가렸어요. 캡처가 밖으로 나갈 수 있으니까요.' },
  };
  function applyContext(findings, ctx) {
    const c = CONTEXTS[ctx] || CONTEXTS.market;
    // 사람이 직접 켜고 끈 것(touched)은 그대로 둔다
    findings.forEach(f => { if (f.type !== 'manual' && !f.touched) f.selected = !c.keep.includes(f.type); });
    return findings;
  }

  const BANK =/(국민|신한|농협|우리|하나|기업|카카오|토스|새마을|우체국|수협|씨티|SC|케이뱅크|부산|대구|광주|경남|전북|제주|은행|계좌|입금|예금주)/;
  const PLATE_CH = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육공해국합';
  const RE = {
    rrn: /(?<!\d)(\d{2})(\d{2})(\d{2})(-?)[1-8]\d{6}(?!\d)/g, // 주민등록번호와 외국인등록번호(5~8)
    card: /(?<!\d)\d{4}-?\d{4}-?\d{4}-?\d{4}(?!\d)/g,
    license: /(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)/g,
    passport: /[MSRODG]\d{8}|[MSRODG]\d{3}[A-Z]\d{4}/g,
    password: /(비밀번호|비번|패스워드|암호|PW|pw|Pw|password|PASSWORD)[:：=]?([^\s가-힣]{4,}|\d{4,})/g,
    phone: /(?<!\d)((01[016789]-?\d{3,4}-?\d{4})|(0(2|[3-6][1-5])-\d{3,4}-\d{4}))(?!\d)/g,
    digits3: /\d{2,6}-\d{2,6}-\d{2,7}(-\d{1,6})?/g,
    plate: new RegExp('(?<!\\d)\\d{2,3}[' + PLATE_CH + ']\\d{4}(?!\\d)', 'g'),
    apt: /\d{1,4}동(\d{1,4}호)?|\d{3,4}호/g,
    // 도로명 + 건물번호. 뒤에 '만원·개·시' 같은 단위가 붙으면 주소가 아니다 (예: '여기로 3만원')
    roadAddr: /(?<=[가-힣0-9])(로|길)\d{1,5}(-\d{1,4})?(?!\d)(?!(만|천|원|개|명|시|분|초|일|월|년|번째|위|등|층|kg|km|cm|%))/,
    region: /(특별시|광역시|특별자치|[가-힣]+(시|군|구|읍|면)|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/,
    school: /[가-힣]{1,12}(초등학교|중학교|고등학교|유치원|어린이집|대학교)/g,
    child: /\d학년\d{1,2}반([가-힣]{2,4})?/g,
    nameLabel: /^(받는분|받는사람|받는이|수령인|수취인|성명|성함|이름|예금주|보내는분|보내는사람|보내는이|고객명|담임|담당자|예약자|주문자|신청자|보호자|입금자|송금인|구매자|판매자|대표자|작성자)[:：]?$/,
    nameLabelGlued: /^(받는분|받는사람|받는이|수령인|수취인|성명|성함|이름|예금주|보내는분|보내는사람|보내는이|고객명|담임|담당자|예약자|주문자|신청자|보호자|입금자|송금인|구매자|판매자|대표자|작성자)[:：]?([가-힣]{2,5})(?=[\d(-]|$)/,
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

  // 이름이 아닌 흔한 말 (조사·어미·동사)
  const NOT_NAME = /^(선생|부서|업무|교사|직원|관리|센터|고객|회원|입니다|이에요|예요|이고|이며|이요|으로|에게|에서|까지|부터|님께|입금|계좌|은행|보내|드려|주세|해주|합니다|있어|없어|이다|이랑|하고|씨에게|번호|확인|입력|선택|변경|없음|전용|표|택배)/;
  const SURNAME = /^[김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부가복태목형피두감음빈동온호범좌팽승간상갈시견당화창]/;
  // '○○님에게'에서 사람 이름이 아닌 말 (고객님, 기사님 같은 호칭)
  const NOT_NAME_SIR = /^(고객|회원|기사|선생|사장|대표|부장|과장|차장|팀장|원장|교수|작가|주인|형|누|언니|오빠|구매자|판매자|관리자|담당자|운영자|사용자|이용자|보호자|신청자|주문자|예약자|배송기사|택배기사|집주인|사모|아드|따|손)$/;
  const NAME_HEAD_BAD = /^[을를은는에의도와과만으로표님께]/;
  const okName = t => /^[가-힣]{2,5}$/.test(t) && !NOT_NAME.test(t) && !NAME_HEAD_BAD.test(t);
  // 날짜(2026-11-12)·짧은 숫자는 계좌가 아니다
  const isDate = t => /^(19|20)\d{2}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/.test(t) || /^\d{2}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/.test(t);
  const digitCount = t => t.replace(/\D/g, '').length;
  const validYMD = (mm, dd) => +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31;
  const REGION_NAME = /(특별시|광역시|특별자치|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/;
  const NOT_REGION = /^(다시|혹시|역시|반드시|잠시|즉시|동시|당시|오시|하시|보시|주시|가시|드시|이구|친구|가구|도구|입구|출구|요구|연구|통구|부군|아군|적군)$/;

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
      const map = [];   // 글자 → OCR 낱말 번호 (상자 위치용)
      const tok = [];   // 글자 → 진짜 띄어쓰기 기준 덩어리 번호
      // Tesseract는 한글을 '받','는','분'처럼 한 글자씩 낱말로 나누기도 한다.
      // 그래서 낱말 사이 실제 간격이 글자 높이의 0.65배보다 넓을 때만 띄어쓰기로 본다 (굵은 한글은 글자 사이도 0.5배쯤 벌어진다).
      const hs = words.map(w => w.bbox.y1 - w.bbox.y0).sort((x, y) => x - y);
      const lineH = hs[hs.length >> 1] || 10;
      let t = 0;
      words.forEach((w, i) => {
        if (i > 0 && w.bbox.x0 - words[i - 1].bbox.x1 > lineH * 0.65) t++;
        for (const ch of w.text.replace(/\s+/g, '')) { compact += ch; map.push(i); tok.push(t); }
      });
      // OCR이 숫자 0·1을 O·l로 잘못 읽는 경우를 바로잡는다 (글자 수는 그대로)
      compact = compact
        .replace(/[Oo〇](?=[\d-])|(?<=[\d-])[Oo〇]/g, '0')
        .replace(/[lI|](?=[\d-])|(?<=[\d-])[lI|]/g, '1')
        .replace(/[—–~]/g, '-');
      const used = new Array(compact.length).fill(false);
      const wordStart = k => k === 0 || k >= compact.length || tok[k] !== tok[k - 1];
      const wordEnd = k => k === compact.length || tok[k] !== tok[k - 1];

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
      run('card', RE.card, mm => {
        const s0 = mm.index, t = mm[0];
        if (!luhn(t) || !/^[2-69]/.test(t)) return null;
        // 4자리씩 띄어 쓰였거나 하이픈이 있거나, 근처에 카드라는 말이 있어야 카드로 본다
        const grouped = /-/.test(t) || [4, 8, 12].every(o => wordStart(s0 + o));
        if (!grouped && !/(카드|CARD|Card|VISA|Visa|MASTER|Master)/.test(compact)) return null;
        return [s0, s0 + t.length];
      });
      run('license', RE.license);
      run('passport', RE.passport, mm => (/(여권|PASSPORT|Passport|passport)/.test(compact) || /^[MSRODG]\d{3}[A-Z]/.test(mm[0])
        ? [mm.index, mm.index + mm[0].length] : null));
      run('password', RE.password, mm => {
        const s = mm.index + mm[0].length - mm[2].length;
        return [s, s + mm[2].length];
      });
      const rrnWord = /(주민|등록번호|외국인)/.test(compact);
      run('rrn', RE.rrn, mm => (validYMD(mm[2], mm[3]) && (mm[4] === '-' || rrnWord) ? [mm.index, mm.index + mm[0].length] : null));
      run('phone', RE.phone);
      // 2) 숫자-숫자-숫자: 운송장 / 계좌
      const isTracking = /(운송장|송장|택배)/.test(compact);
      const isBank = BANK.test(compact);
      RE.digits3.lastIndex = 0;
      let m;
      while ((m = RE.digits3.exec(compact))) {
        const s = m.index, e = s + m[0].length;
        const t = m[0];
        if (isDate(t) || digitCount(t) < 9) continue; // 날짜·짧은 번호는 건너뛴다
        if (/^(19|20)\d{2}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])/.test(t)) continue; // '2026-11-11 13:42'가 붙어 읽힌 것
        if (isTracking) add('tracking', s, e);
        else if (isBank) {
          if (add('account', s, e)) {
            // 계좌 바로 뒤의 '낱말 하나'가 2~4글자 이름이면 예금주로 본다 ('입니다', '으로' 같은 말은 빼고)
            // 숫자와 이름 사이 간격은 좁게 읽히기도 해서, 띄어쓰기 대신 '이어지는 한글 덩어리'를 본다
            let k = e; while (k < compact.length && /[가-힣]/.test(compact[k]) && (k === e || !wordStart(k))) k++;
            const next = compact.slice(e, k);
            if (/^[가-힣]{2,4}$/.test(next) && okName(next)) add('name', e, k);
          }
        } else add('number', s, e);
      }
      // 운송장 번호는 하이픈 없이 12자리로 쓰는 일이 많다 (같은 줄에 운송장·송장·택배라는 말이 있을 때만)
      if (isTracking) run('tracking', /(?<![\d-])\d{10,14}(?![\d-])/g);
      // 3) 차 번호판
      run('plate', RE.plate);
      // 4) 주소 (도로명 + 지역 이름이 같이 있으면 줄 전체를 주소로)
      const road = RE.roadAddr.exec(compact);
      if (road) {
        // 도로명 앞에 시·도 이름이나 '○○시/군/구' 낱말이 있어야 주소로 본다 ('다시', '친구' 같은 말은 빼고)
        // '가상로'처럼 도로명이 시작하는 낱말의 첫 글자 위치를 찾는다
        let rs = road.index; while (rs > 0 && !wordStart(rs)) rs--;
        const before = compact.slice(0, rs), inWord = compact.slice(rs, road.index);
        // 띄어쓰기가 붙어 읽힌 경우('전북전주시덕진구가상로')도 같은 낱말 안의 지역 이름을 본다.
        // '가상로45번길'처럼 '번길'이 붙은 도로명은 그것만으로도 주소로 본다.
        let regionOk = REGION_NAME.test(before) || REGION_NAME.test(inWord)
          || /[가-힣]{2,6}(시|군|구)[가-힣]{2,}$/.test(inWord) || /^\d{1,4}번길/.test(compact.slice(road.index + 1));
        if (!regionOk) {
          for (let a = 0; a < rs && !regionOk; a++) {
            if (!wordStart(a)) continue;
            let b = a; while (b < rs && !wordEnd(b + 1)) b++;
            const w = compact.slice(a, b + 1);
            if (/^[가-힣]{1,6}(시|군|구)$/.test(w) && !NOT_REGION.test(w)) regionOk = true;
          }
        }
        if (regionOk) add('address', 0, compact.length, { overlap: true });
      } else if (REGION_NAME.test(compact) && /[가-힣]{1,6}(시|군|구)/.test(compact.replace(REGION_NAME, ''))
        && /[가-힣A-Za-z]\d{1,3}(-\d{1,4})?$/.test(compact) && !/(청|역|점|센터|병원|학교)\d/.test(compact)) {
        // 도로명이 흐려서 못 읽었어도 '전북 전주시 덕진구 ○○ 249'처럼 시·도와 시·군·구 뒤 끝에 건물 번호가 오면 주소로 본다
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
      // '받는분 홍길동', '이름: 홍길동'처럼 이름표 낱말 바로 뒤의 낱말을 이름으로 본다 ('이름을', '이름표에'는 빼고)
      for (let a = 0; a < compact.length; a++) {
        if (!wordStart(a)) continue;
        let b = a; while (b + 1 < compact.length && !wordStart(b + 1)) b++;
        const w = compact.slice(a, b + 1);
        // '받는 분 홍길동'처럼 이름표가 두 낱말로 나뉜 경우: 두 낱말을 붙여서 본다
        if (/^(받는|보내는)$/.test(w) && b + 1 < compact.length) {
          let c = b + 1; while (c + 1 < compact.length && !wordStart(c + 1)) c++;
          if (/^(분|사람|이)[:：]?$/.test(compact.slice(b + 1, c + 1))) b = c;
        }
        const w2 = compact.slice(a, b + 1);
        const glued = w2.match(RE.nameLabelGlued);
        if (glued && okName(glued[2])) { add('name', a + glued[0].length - glued[2].length, a + glued[0].length); continue; }
        if (RE.nameLabel.test(w2) && b + 1 < compact.length) {
          let c = b + 1; while (c + 1 < compact.length && !wordStart(c + 1)) c++;
          const next = compact.slice(b + 1, c + 1);
          if (okName(next)) add('name', b + 1, c + 1);
          else {
            const lead = next.match(/^([가-힣]{2,4})(?=[\d(（-])/); // 이름 바로 뒤에 전화번호가 붙어 읽힌 경우
            if (lead && okName(lead[1])) add('name', b + 1, b + 1 + lead[1].length);
          }
        }
      }
      // '김하늘님에게 보냈어요'처럼 성씨로 시작하는 3글자 + '님' (고객님·기사님 같은 호칭은 빼고)
      for (let a = 0; a < compact.length; a++) {
        if (!wordStart(a)) continue;
        const mm = compact.slice(a).match(/^([가-힣]{3})님(에게|께|이|의|한테|으로|과|와|을|은|,|$)/);
        if (mm && SURNAME.test(mm[1]) && !NOT_NAME_SIR.test(mm[1]) && okName(mm[1])) add('name', a, a + 3);
      }
      run('email', RE.email);
    }
    return out;
  }

  // 한 번 찾은 이름이 사진의 다른 곳에도 나오면 거기도 찾는다 ('받는 분 김하늘'을 찾으면 맨 위 '김하늘님에게'도)
  function findNames(lines, names) {
    const out = [];
    const list = [...new Set(names)].filter(n => /^[가-힣]{2,5}$/.test(n));
    if (!list.length) return out;
    for (const line of lines) {
      const words = (line.words || []).filter(w => w.text && w.text.trim());
      let compact = ''; const map = [];
      words.forEach((w, i) => { for (const ch of w.text.replace(/\s+/g, '')) { compact += ch; map.push(i); } });
      for (const n of list) {
        let k = compact.indexOf(n);
        while (k >= 0) {
          const idx = [...new Set(map.slice(k, k + n.length))];
          out.push({ type: 'name', text: n, box: unionBox(idx.map(i => words[i].bbox)) });
          k = compact.indexOf(n, k + n.length);
        }
      }
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
    RE.digits3.lastIndex = 0;
    const nums = (compact.match(RE.digits3) || []).filter(t => !isDate(t) && digitCount(t) >= 9);
    if (nums.length) found.push('운송장·계좌 번호');
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
    if (has('child')) {
      cards.push({ level: 3, title: '아이의 학교와 이름을 알 수 있어요',
        body: '학교·학년·반·이름이 보여요. 낯선 사람이 이름을 부르며 다가오면 아이는 아는 사람이라고 믿기 쉬워요.' });
    } else if (has('school')) {
      const kid = on.some(f => f.type === 'school' && /(초등학교|중학교|고등학교|유치원|어린이집)/.test(f.text || ''));
      cards.push(kid
        ? { level: 2, title: '아이가 다니는 학교가 보여요', body: '학교 이름과 다른 정보가 합쳐지면 아이가 누구인지 알 수 있어요.' }
        : { level: 1, title: '다니는 학교가 보여요', body: '학교 이름으로 어느 학교 학생인지 알 수 있어요. 학번이나 이름이 함께 보이지 않는지 확인하세요.' });
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
    if (has('barcode') && !has('tracking') && !has('qr')) {
      cards.push({ level: 1, title: '바코드가 보여요', body: '택배 송장 바코드라면 운송장 번호가 들어 있어 조회할 수 있어요. 상품 바코드라면 괜찮아요.' });
    }
    if (has('tracking') || has('qr')) {
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

  const api = { TYPES, CONTEXTS, applyContext, analyzeLines, findNames, scanPlainText, buildReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Detect = api;
})(typeof window !== 'undefined' ? window : globalThis);
