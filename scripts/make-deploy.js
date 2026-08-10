#!/usr/bin/env node
/*
 * 배포용 폴더를 만든다.  실행: node scripts/make-deploy.js
 *
 * 왜 복사본을 저장소에 두지 않고 매번 만드는가
 *   HTML 을 deploy/index.html 로 복사해 커밋해두면 원본과 갈라진다. 며칠 뒤에는
 *   어느 쪽이 최신인지 알 수 없게 되고, 심사자가 보는 건 대개 오래된 쪽이다.
 *   그래서 deploy/ 는 생성물이고 .gitignore 대상이다.
 *
 * 왜 저장소를 통째로 올리지 않는가
 *   docs/ 에 PRD·회의록·레퍼런스 분석이 들어 있다. 저장소를 그대로 배포하면
 *   사이트주소/docs/PRD_v1.0.md 로 내부 판단 근거가 전부 열린다.
 *   배포 대상은 화면에 필요한 파일뿐이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'deploy');

const FILES = [
  ['AI_Builder_Origin_v3.html', 'index.html'],  // 루트 주소로 열리도록 이름을 바꾼다
  ['og-cover-v2.png', 'og-cover-v2.png'],
];

// 폴더 통째로 복사할 대상
const DIRS = [
  'assets',
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const dir of DIRS) {
  const from = path.join(ROOT, dir);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(OUT, dir), { recursive: true });
  const count = fs.readdirSync(path.join(OUT, dir), { recursive: true }).length;
  console.log('  ' + dir + '/  →  deploy/' + dir + '/  (' + count + '개)');
}

for (const [src, dest] of FILES) {
  const from = path.join(ROOT, src);
  if (!fs.existsSync(from)) { console.error('없음: ' + src); process.exit(1); }
  fs.copyFileSync(from, path.join(OUT, dest));
  console.log('  ' + src + '  →  deploy/' + dest);
}

/* 색인 차단을 두 겹으로 둔다. HTML 의 robots 메타는 파일을 읽어야 적용되지만
   robots.txt 와 응답 헤더는 크롤러가 먼저 본다. 미팅 전 시안이므로 확실히 막는다. */
fs.writeFileSync(path.join(OUT, 'robots.txt'),
  '# 클라이언트 미팅 전 시안이다. 공개 확정 시 이 파일과 index.html 의 robots 메타를 함께 푼다.\n' +
  'User-agent: *\nDisallow: /\n');
console.log('  robots.txt 생성 (Disallow: /)');

fs.writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({
  headers: [{
    source: '/(.*)',
    headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
  }]
}, null, 2) + '\n');
console.log('  vercel.json 생성 (X-Robots-Tag: noindex)');

/* deploy/ 자체가 저장소의 .gitignore 대상이므로 Vercel CLI 가 상위 규칙을 물려받으면
   내부 정적 자산까지 제외한다. 배포 폴더 전용 규칙을 두어 assets/ 를 함께 업로드한다. */
fs.writeFileSync(path.join(OUT, '.vercelignore'), '.vercel\n');
console.log('  .vercelignore 생성 (정적 자산 포함)');

const size = fs.statSync(path.join(OUT, 'index.html')).size;
console.log('\n배포 폴더 준비 완료 — ' + OUT);
console.log('index.html ' + (size / 1024).toFixed(1) + ' KB\n');
console.log('올리는 법 (둘 중 하나)');
console.log('  1) vercel.com/new 에서 deploy 폴더를 드래그');
console.log('  2) npx vercel deploy deploy --prod');
console.log('\n⚠️ 무료 플랜에는 비밀번호 보호가 없다. 주소를 아는 사람은 누구나 볼 수 있다.');
