#!/usr/bin/env node
/*
 * 로컬 미리보기 서버. 배포하기 전에 브라우저에서 그대로 확인한다.
 * 실행: node scripts/serve.js        (기본 4300 포트)
 *       node scripts/serve.js 5000   (포트 지정)
 *
 * 왜 필요한가
 *   이 시안은 단일 HTML 이라 파일을 더블클릭해도 열리기는 한다. 그런데 file:// 로 열면
 *   실제와 다르게 동작하는 것이 있다 —
 *     · Tiptap 편집기: module import 가 CORS 로 막혀 관리자 화면이 자리표시자만 남는다
 *     · 채널톡·Supabase 등 외부 스크립트: origin 이 null 이라 붙지 않는다
 *   그래서 배포 전 확인은 반드시 http:// 로 해야 한다.
 *
 * 왜 배포 폴더가 아니라 원본을 서빙하는가
 *   deploy/ 는 make-deploy.js 가 만드는 산출물이라 한 단계 낡아 있을 수 있다.
 *   미리보기는 지금 고친 파일을 그대로 봐야 의미가 있다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 4300;
const ENTRY = 'AI_Builder_Origin_v3.html';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  if (rel === '/') rel = '/' + ENTRY;
  const file = path.join(ROOT, rel);

  /* 상위 경로 탈출을 막는다. 로컬 전용이라도 ../ 로 홈 디렉터리가 열리면 안 된다. */
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('403'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 — ' + rel);
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    /* 고칠 때마다 새로고침으로 바로 보여야 한다. 캐시가 남으면 "안 바뀌었다"가 된다. */
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error('\n포트 ' + PORT + ' 가 이미 쓰이고 있다. 다른 포트로 실행한다:');
    console.error('  node scripts/serve.js ' + (PORT + 1) + '\n');
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log('\n  로컬 미리보기 준비됨');
  console.log('  ─────────────────────────────────────────');
  console.log('  공개 사이트   http://localhost:' + PORT + '/');
  console.log('  관리자 화면   http://localhost:' + PORT + '/#/admin');
  console.log('  ─────────────────────────────────────────');
  console.log('  파일을 고치고 브라우저 새로고침하면 바로 반영된다.');
  console.log('  끄기: Ctrl+C\n');
});
