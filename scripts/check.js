#!/usr/bin/env node
/*
 * 시안 파일을 검사한다.  실행: node scripts/check.js
 *
 * 브라우저 없이 도는 정적 검사다. 여기서 걸리는 것들은 전부 실제로 한 번씩 사고가 났던 항목이다.
 *
 *   CSS 주석 짝      닫지 않으면 뒤따르는 규칙이 통째로 사라진다. 두 번 당했다.
 *   주석 밖 한글     같은 사고의 다른 얼굴. CSS 는 잘못된 토큰을 조용히 버린다.
 *   script 구문      단일 파일이라 한 곳이 깨지면 페이지 전체가 죽는다.
 *   div 균형         정규식으로 마크업을 고치다 닫는 태그를 남긴 적이 있다.
 *   INSIGHT 데이터   실제로 실행해 필수 필드와 정렬을 확인한다.
 *   기능 잔존        Codex 가 같은 파일을 동시에 고치면서 완성된 기능이 사라진 적이 세 번 있다.
 *
 * 마지막 항목이 이 파일을 만든 이유다. 커밋 전에 여기서 잡는다.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const P = path.join(__dirname, '..', 'AI_Builder_Origin_v3.html');
const s = fs.readFileSync(P, 'utf8');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

/* ── CSS ─────────────────────────────────────────────── */
const style = s.slice(s.indexOf('<style>'), s.indexOf('</style>'));
const open = (style.match(/\/\*/g) || []).length, close = (style.match(/\*\//g) || []).length;
ok(open === close, 'CSS 주석 ' + open + '/' + close);

let depth = 0; const leaked = [];
style.split('\n').forEach((ln, i) => {
  let rest = ln, outside = '';
  while (rest.length) {
    if (!depth) {
      const j = rest.indexOf('/*');
      if (j < 0) { outside += rest; break; }
      outside += rest.slice(0, j); rest = rest.slice(j + 2); depth = 1;
    } else {
      const j = rest.indexOf('*/');
      if (j < 0) break;
      rest = rest.slice(j + 2); depth = 0;
    }
  }
  if (/[가-힣]/.test(outside)) leaked.push((i + 1) + ': ' + outside.trim().slice(0, 40));
});
ok(!leaked.length, '주석 밖 한글 ' + leaked.length + '건' + (leaked.length ? ' → ' + leaked[0] : ''));

/* ── 스크립트 ────────────────────────────────────────── */
const scripts = [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((js, i) => {
  try { new vm.Script(js); ok(true, 'script #' + (i + 1) + ' 구문'); }
  catch (e) { ok(false, 'script #' + (i + 1) + ' — ' + e.message); }
});

/* ── 공유 카드(OG) ───────────────────────────────────────
   규격은 절대 URL 을 요구한다. 상대 경로여도 슬랙·카톡은 알아서 풀어 주기 때문에
   눈으로 보면 멀쩡하다 — 안 풀어 주는 크롤러에서만 카드가 빈다. 사람 눈으로는
   못 잡는 종류라 여기서 잡는다. 도메인을 바꿀 때 한 곳만 고치는 사고도 함께 막는다. */
const OG_URL = ['og:url', 'og:image', 'og:image:secure_url'].map(p =>
  [p, (s.match(new RegExp('<meta property="' + p + '" content="([^"]*)"')) || [])[1]]);
OG_URL.push(['twitter:image',
  (s.match(/<meta name="twitter:image" content="([^"]*)"/) || [])[1]]);
const ogBad = OG_URL.filter(([, v]) => !v || !/^https:\/\//.test(v)).map(([p]) => p);
ok(!ogBad.length, 'OG 절대 URL ' + (OG_URL.length - ogBad.length) + '/' + OG_URL.length +
  (ogBad.length ? ' → 상대경로·누락: ' + ogBad.join(', ') : ''));
const ogHosts = [...new Set(OG_URL.map(([, v]) => v && v.replace(/^(https:\/\/[^/]+).*/, '$1')).filter(Boolean))];
ok(ogHosts.length <= 1, 'OG 호스트 일치' + (ogHosts.length > 1 ? ' → 갈림: ' + ogHosts.join(' / ') : ' (' + (ogHosts[0] || '-') + ')'));

/* ── 마크업 ──────────────────────────────────────────── */
const body = s.slice(s.indexOf('<body'), s.indexOf('<script>', s.indexOf('<body')));
const o = (body.match(/<div\b/g) || []).length, c = (body.match(/<\/div>/g) || []).length;
ok(o === c, 'div 균형 ' + o + '/' + c);

/* ── 콘텐츠 데이터 — 실제로 실행해 본다 ──────────────── */
const whole = scripts.find(j => j.includes('window.__INSIGHT'));
if (!whole) ok(false, 'INSIGHT 데이터 블록을 찾지 못함');
else {
  const end = whole.indexOf('window.__insightRow=insightRow;');
  const dataJs = whole.slice(0, whole.indexOf('\n', end) + 1) + '})();';
  const sandbox = { window: {}, document: { getElementById: () => ({ set innerHTML(v) { sandbox.__html = v } }) } };
  vm.createContext(sandbox);
  try {
    new vm.Script(dataJs).runInContext(sandbox);
    const A = sandbox.window.__INSIGHT;
    const art = A.filter(x => x.kind === 'article'), vid = A.filter(x => x.kind === 'video');
    ok(A.length > 0, '항목 ' + A.length + '건 (아티클 ' + art.length + ' · 영상 ' + vid.length + ')');
    ok(new Set(A.map(x => x.id)).size === A.length, 'id 중복 없음');
    ok(art.every(x => x.title && x.lead && x.by && x.date && x.cover && x.body && x.body.length), '아티클 필수 필드');
    ok(vid.every(x => x.vid && x.title && x.by && x.date), '영상 필수 필드');
    const dates = art.map(x => x.date);
    ok(dates.join('|') === [...dates].sort().reverse().join('|'), '아티클 최신순 정렬');
    const covers = [...new Set(art.map(x => x.cover))].sort();
    ok(covers.every(cv => style.includes('.cover--' + cv + '{')), '표지 클래스 정의 ' + covers.join(','));
    ok(/insight-item/.test(sandbox.__html || ''), '홈 목록 렌더 (' + ((sandbox.__html || '').match(/class="insight-item"/g) || []).length + '행)');
    /* §7.5 — 가격 소구와 검증 불가 수치는 카피에 넣지 않는다 */
    const txt = JSON.stringify(A);
    const banned = ['100%', '보장', '누적 매출', '평점', '만원', '천만', '선별'].filter(w => txt.includes(w));
    ok(!banned.length, '§7.5 금지 표현 없음' + (banned.length ? ' → ' + banned.join(',') : ''));
  } catch (e) { ok(false, '데이터 실행 — ' + e.message); }
}

ok((s.match(/const INSIGHT=\[/g) || []).length === 1, 'INSIGHT 배열 정의 1곳');

/* ── 화면 계약 ───────────────────────────────────────────
   "파일에 있다"와 "화면에서 동작한다" 사이가 이번에 크게 벌어졌다.
   브라우저를 못 쓰는 상황(확장이 localhost 를 막음)이 반복돼, 눈으로만 잡히던 것을
   여기서 잡는다. 전부 실제로 의심했던 지점이다. */
/* 정규식 대신 인덱스로 본다 — 이 파일을 스크립트로 생성하다 백슬래시가 사라진 적이 있다. */
const near = (anchor, needle, span) => {
  const i = s.indexOf(anchor);
  return i >= 0 && s.slice(i, i + (span || 200)).indexOf(needle) >= 0;
};
/* 🔴 예전에는 near("h==='#/admin'", 'setChrome()', 140) 이었다. setChrome 안의
   location.hash==='#/admin' 에 걸린 뒤 그 아래 admRepaint 의 setChrome() 까지가
   우연히 140자 안이라 통과하던 것이고, setChrome 이 세 줄 늘자 로직은 멀쩡한데 실패했다.
   위치가 아니라 사실 두 개를 직접 본다 — 토글이 있는가, 그리고 홈에서 벗겨지는가. */
ok(s.includes("classList.toggle('admin-on'"), '#/admin 진입 시 사이트 크롬 토글');
ok(near('const showHome=', "remove('admin-login','admin-on')", 320), '홈 복귀 시 크롬 복원');
/* 상세 URL 이 생기기 전에는 href="#" 라 내부 링크의 기본 동작을 전부 막았다.
   href 가 실제 주소로 바뀐 뒤에도 그 코드가 남아 홈에서 글을 눌러도 아무 일이 없었다.
   빈 앵커일 때만 막아야 한다. */
ok(!s.includes('if(!external) e.preventDefault()'), '링크 이동을 무조건 막지 않음');
ok(s.includes("closest('[data-signin]"), '클릭 위임에 data-signin 포함');
ok(s.includes('data-signin="builder"') && s.includes('data-signin="admin"'), '미리보기 버튼 2종');
ok(s.includes('data-signout'), '로그아웃 버튼');
/* CSS 가 겨냥하는 요소가 실제로 있는지. 클래스를 바꾸면 규칙이 조용히 죽는다. */
const targets = ['header', 'dock', 'chat', 'totop', 'rail'];
const missTarget = targets.filter(t => !s.includes('class="' + t + '"'));
ok(!missTarget.length, '크롬 숨김 대상 존재 ' + (targets.length - missTarget.length) + '/' + targets.length +
   (missTarget.length ? ' → 없음: ' + missTarget.join(', ') : ''));
/* 라우트마다 렌더러가 연결돼 있는지 */
const routes = {'#/work':'renderWorkList','#/insight':'renderInsightList','#/faq':'renderFaq',
                '#/education':'renderEducationList','#/crew':'renderCrewList','#/admin':'renderAdminLogin'};
/* 🔴 "(h===" 까지 붙여 찾는다. 예전에는 "h==='#/admin'" 으로 찾아서 라우터가 아니라
   setChrome 의 location.hash==='#/admin' 에 먼저 걸렸다 — 우연히 260자 안에 renderAdminLogin
   이 있어서 통과했을 뿐이고, 그 사이에 코드가 몇 줄 들어가자 라우터는 멀쩡한데 실패했다.
   라우터 분기는 전부 "}else if(h===" · "else if(h===" 형태라 여는 괄호가 앞에 온다. */
const badRoute = Object.entries(routes).filter(([h, fn]) => {
  const i = s.indexOf("(h==='" + h + "'");
  return i < 0 || s.slice(i, i + 260).indexOf(fn) < 0;
}).map(([h]) => h);
ok(!badRoute.length, '라우트-렌더러 연결 ' + (Object.keys(routes).length - badRoute.length) + '/' +
   Object.keys(routes).length + (badRoute.length ? ' → 끊김: ' + badRoute.join(', ') : ''));

/* ── 홈 #builders ↔ CREW 배열 ─────────────────────────────
   빌더 정보가 두 곳에 있다. 홈 카드는 손으로 쓴 마크업이고(§4.1 이 이 구간의 마크업을
   고정해 두었다), 사이드페이지는 CREW 배열에서 그린다. 한쪽만 고치면 홈에서는 김도윤인데
   프로필을 누르면 다른 사람이 나오는 상태가 된다 — "누가 만드는지 숨기지 않습니다" 라고
   써 둔 섹션에서 그건 오타가 아니라 거짓말이 된다. 이름 · 링크 · Work 배정을 대조한다. */
const crewSrc = s.slice(s.indexOf('const CREW=['), s.indexOf('/* 커리큘럼은'));
const crewIds = [...crewSrc.matchAll(/\{id:'([\w-]+)',name:'([^']+)'/g)].map(m => [m[1], m[2]]);
const crewWorks = [...crewSrc.matchAll(/works:\[([^\]]*)\]/g)]
  .map(m => m[1].split(',').map(x => x.replace(/'/g, '').trim()).filter(Boolean));
const cardHtml = [...s.matchAll(/<article class="builder-card">([\s\S]*?)<\/article>/g)].map(m => m[1]);
ok(crewIds.length > 0 && crewIds.length === cardHtml.length,
  '빌더 수 일치 — CREW ' + crewIds.length + ' · 홈 카드 ' + cardHtml.length);
const drift = [];
cardHtml.forEach((html, i) => {
  const entry = crewIds[i]; if (!entry) return;
  const [id, name] = entry;
  const cardName = (html.match(/<h3>([^<]+)<\/h3>/) || [])[1];
  if (cardName !== name) drift.push('이름 ' + cardName + ' ≠ ' + name);
  if (!html.includes('href="#/crew/' + id + '"')) drift.push(name + ' 카드에 #/crew/' + id + ' 링크 없음');
  const cardWorks = [...html.matchAll(/href="#\/work\/([\w-]+)"/g)].map(m => m[1]);
  const want = (crewWorks[i] || []).join(',');
  if (cardWorks.join(',') !== want) drift.push(name + ' Work 배정 ' + cardWorks.join('·') + ' ≠ ' + want.replace(/,/g, '·'));
});
ok(!drift.length, '홈 카드 ↔ CREW 대조' + (drift.length ? ' → 어긋남: ' + drift.join(' / ') : ' 일치'));

/* ── 함수 정의 존재 ───────────────────────────────────────
   🔴 이름만 세면 안 된다. renderSpace 정의가 통째로 지워졌는데 route 안의 호출부가
   남아 있어서 검사를 통과했고, 배포 후에야 ReferenceError 로 드러났다(2026-08-08).
   "const 이름=" 형태로 정의 자체를 확인한다. */
const DEFS = ['profileForm', 'renderSpace', 'renderAdmin', 'renderAdminLogin', 'renderAdminBody',
  'renderWork', 'renderInsight', 'renderWorkList', 'renderInsightList', 'renderFaq',
  'renderEducationList', 'renderEducationTrack', 'renderCrewList', 'renderCrew', 'crewCard',
  'admRepaint', 'setChrome', 'editTarget', 'readAvatar', 'initialOf',
  'myProfile', 'spaceRow', 'newForm', 'initAuth', 'resolveRole'];
const noDef = DEFS.filter(n => !s.includes('const ' + n + '='));
ok(!noDef.length, '함수 정의 ' + (DEFS.length - noDef.length) + '/' + DEFS.length +
  (noDef.length ? ' → 정의 없음(호출만 남음): ' + noDef.join(', ') : ''));

/* 선언 순서 — const 는 호출 시점에 초기화돼 있어야 한다. route() 가 마지막에 돌므로
   렌더러는 그보다 위에 있어야 한다. 블록을 옮기다 순서가 뒤집히면 TDZ 로 죽는다. */
const orderPairs = [['renderSpace', 'route='], ['profileForm', 'renderSpace'],
  ['CREW=', 'crewCard'], ['crewCard', 'route='],
  ['renderAdmin=', 'admRepaint'], ['setChrome', 'admRepaint']];
const badOrder = orderPairs.filter(([a, b]) => {
  const ia = s.indexOf('const ' + a), ib = s.indexOf('const ' + b);
  return ia < 0 || ib < 0 || ia > ib;
}).map(([a, b]) => a + ' → ' + b);
ok(!badOrder.length, '선언 순서' + (badOrder.length ? ' → 뒤집힘: ' + badOrder.join(', ') : ' 정상'));

/* ── 기능 잔존 ───────────────────────────────────────── */
const MUST = {
  '로그인 상태': 'admAuth', '스페이스 등록': 'space__new',
  '역할 권한': 'ROLE_CAN', '역할 목록': 'const ROLES',
  '빌더 초대': 'adm__inviteForm', '반려 사유': 'adm__rejectForm',
  'dock 회피 실측': '--dock-h', '채널톡 키': 'CHANNEL_PLUGIN_KEY',
  'INSIGHT 단일 소스': 'window.__INSIGHT', '표지 폴백': 'cover--01',
  'Google 로그인': 'signInWithOAuth', 'Supabase 설정': 'SUPABASE_ANON_KEY',
  '작업물 연결': 'builder-work', 'Work 상세 캡처': 'detail__shot',
  /* 회의록 2026-08-05 확정 요건 — 관리자 콘텐츠 관리는 Tiptap 이다. 이 네 개가 한 세트다:
     로더가 없으면 편집기가 안 뜨고, renderDoc 이 없으면 공개 페이지가 본문을 못 그리고,
     toDoc 이 없으면 기존 8건이 통째로 빈다. 하나라도 빠지면 여기서 걸린다. */
  'Tiptap 로더': 'window.__TIPTAP', 'Tiptap 마운트': 'mountEditor',
  '본문 렌더러': 'renderDoc', '레거시 본문 승격': 'const toDoc',
  '본문 링크 스킴 검사': 'const safeHref',
  /* 리드 문단의 문장 단위 줄바꿈. 이 함수가 없으면 esc() 로 되돌아가면서
     개행이 공백으로 접혀 두 문장이 한 줄에 붙는다 — 화면은 멀쩡해 보이고 조판만 무너진다. */
  '리드 줄바꿈': 'const leadHTML',
  /* FAQ 사이드페이지의 그룹 라벨 · 아코디언 · 분류 필터.
     라벨이 빠지면 질문이 분류 없이 평평하게 흐르고, <details> 가 div 아코디언으로
     되돌아가면 키보드 조작이 조용히 죽는다 — 마우스로만 보면 똑같이 동작한다.
     칩이 빠지면 12개가 통째로 한 줄에 늘어선다. */
  'FAQ 분류 라벨': 'faqp__cat',
  'FAQ 아코디언': '<details class="faqp__item">',
  'FAQ 분류 필터': 'data-fq="',
  'FAQ 모두 펼치기': 'data-fqall',
  /* 사이드페이지에서 돌아왔을 때 떠났던 자리로 되돌리는 값. 이게 없으면 route 끝의
     scrollTo 가 무조건 0 이 되어 항상 히어로부터 다시 스크롤해야 한다. */
  '홈 스크롤 복원': 'let homeY',
  /* Crew 사이드페이지. 홈 카드의 BUILDER PROFILE 배지는 이 링크가 없으면 다시 죽은
     라벨이 되고, 사진 배선이 빠지면 모든 얼굴이 이니셜로 되돌아간다 —
     둘 다 화면이 무너지지 않아서 눈으로는 "원래 그런 줄" 알고 지나간다. */
  'Crew 배열': 'const CREW=',
  'Crew 프로필 링크': 'href="#/crew/',
  'Crew 사진 배선': 'window.__wirePhotos',
};
const gone = Object.entries(MUST).filter(([, n]) => !s.includes(n)).map(([k]) => k);
const total = Object.keys(MUST).length;
ok(!gone.length, '기능 잔존 ' + (total - gone.length) + '/' + total + (gone.length ? ' → 사라짐: ' + gone.join(', ') : ''));

console.log(fail ? '\n실패 ' + fail + '건 — 고치고 다시 실행할 것\n' : '\n전부 통과\n');
process.exit(fail ? 1 : 0);
