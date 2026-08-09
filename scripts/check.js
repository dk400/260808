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
ok(near("h==='#/admin'", 'setChrome()', 140), '#/admin 진입 시 사이트 크롬 토글');
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
                '#/education':'renderEducation','#/admin':'renderAdminLogin'};
const badRoute = Object.entries(routes).filter(([h, fn]) => {
  const i = s.indexOf("h==='" + h + "'");
  return i < 0 || s.slice(i, i + 260).indexOf(fn) < 0;
}).map(([h]) => h);
ok(!badRoute.length, '라우트-렌더러 연결 ' + (Object.keys(routes).length - badRoute.length) + '/' +
   Object.keys(routes).length + (badRoute.length ? ' → 끊김: ' + badRoute.join(', ') : ''));

/* ── 함수 정의 존재 ───────────────────────────────────────
   🔴 이름만 세면 안 된다. renderSpace 정의가 통째로 지워졌는데 route 안의 호출부가
   남아 있어서 검사를 통과했고, 배포 후에야 ReferenceError 로 드러났다(2026-08-08).
   "const 이름=" 형태로 정의 자체를 확인한다. */
const DEFS = ['profileForm', 'renderSpace', 'renderAdmin', 'renderAdminLogin', 'renderAdminBody',
  'renderWork', 'renderInsight', 'renderWorkList', 'renderInsightList', 'renderFaq',
  'renderEducation', 'admRepaint', 'setChrome', 'editTarget', 'readAvatar', 'initialOf',
  'myProfile', 'spaceRow', 'newForm', 'initAuth', 'resolveRole'];
const noDef = DEFS.filter(n => !s.includes('const ' + n + '='));
ok(!noDef.length, '함수 정의 ' + (DEFS.length - noDef.length) + '/' + DEFS.length +
  (noDef.length ? ' → 정의 없음(호출만 남음): ' + noDef.join(', ') : ''));

/* 선언 순서 — const 는 호출 시점에 초기화돼 있어야 한다. route() 가 마지막에 돌므로
   렌더러는 그보다 위에 있어야 한다. 블록을 옮기다 순서가 뒤집히면 TDZ 로 죽는다. */
const orderPairs = [['renderSpace', 'route='], ['profileForm', 'renderSpace'],
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
};
const gone = Object.entries(MUST).filter(([, n]) => !s.includes(n)).map(([k]) => k);
const total = Object.keys(MUST).length;
ok(!gone.length, '기능 잔존 ' + (total - gone.length) + '/' + total + (gone.length ? ' → 사라짐: ' + gone.join(', ') : ''));

console.log(fail ? '\n실패 ' + fail + '건 — 고치고 다시 실행할 것\n' : '\n전부 통과\n');
process.exit(fail ? 1 : 0);
