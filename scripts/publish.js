#!/usr/bin/env node
/*
 * 검사 → 배포 폴더 생성 → Vercel 배포 → 별칭 연결까지 한 번에.
 * 실행: node scripts/publish.js
 *
 * 왜 스크립트로 묶는가
 *   손으로 하면 세 명령을 순서대로 쳐야 하는데, 마지막 alias 를 빠뜨리면 배포는 됐는데
 *   공유한 링크는 예전 화면을 가리킨다. 아무도 눈치채지 못한 채 옛 시안을 보게 된다.
 *   실제로 놓치기 쉬운 단계라 사람 손에서 뺐다.
 *
 * 왜 검사를 먼저 하는가
 *   깨진 파일을 올리는 것보다 안 올리는 편이 낫다. check.js 가 실패하면 여기서 멈춘다.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SCOPE = 'builderschool';
const ALIAS = 'ai-builder-origin.vercel.app';

/* Windows 의 npx 는 .cmd 라 shell 없이는 실행되지 않는다(Node 24 부터 EINVAL).
   그래서 shell:true 가 필요하고, 그 대가로 deprecation 경고가 뜬다.
   여기서 넘기는 인자는 전부 이 파일 안에 적힌 상수와 CLI 가 돌려준 배포 URL 뿐이라
   외부 입력이 섞이지 않는다 — 경고만 끄고 쓴다. */
process.noDeprecation = true;
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: true, ...opts });

const step = m => console.log('\n▸ ' + m);

try {
  step('파일 검사');
  console.log(run('node', ['scripts/check.js'], { stdio: 'pipe' }).trim());

  step('배포 폴더 생성');
  run('node', ['scripts/make-deploy.js'], { stdio: 'pipe' });
  console.log('  deploy/ 준비 완료');

  step('Vercel 배포');
  const out = run('npx', ['vercel', 'deploy', 'deploy', '--prod', '--yes', '--scope', SCOPE], { stdio: 'pipe' });
  /* CLI 가 출력 형식을 바꿔도 URL 은 남는다. 마지막 것이 이번 배포다. */
  const urls = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g) || [];
  const deployed = urls.filter(u => !u.includes(ALIAS)).pop();
  if (!deployed) { console.error('  배포 URL 을 찾지 못했다. 아래 출력을 확인할 것.\n' + out); process.exit(1); }
  console.log('  ' + deployed);

  step('별칭 연결');
  run('npx', ['vercel', 'alias', 'set', deployed, ALIAS, '--scope', SCOPE], { stdio: 'pipe' });
  console.log('  ' + ALIAS + ' → ' + deployed);

  step('접속 확인');
  /* 별칭이 실제로 새 배포를 가리키는지 확인한다. alias 명령이 성공해도 전파에 몇 초 걸린다. */
  const check = () => new Promise(res => {
    https.get('https://' + ALIAS + '/', r => { r.resume(); res(r.statusCode); })
      .on('error', () => res(0));
  });
  (async () => {
    let code = 0;
    for (let i = 0; i < 6; i++) {
      code = await check();
      if (code === 200) break;
      await new Promise(r => setTimeout(r, 4000));
    }
    if (code === 200) {
      console.log('  200 OK\n');
      console.log('공유 링크  https://' + ALIAS + '\n');
    } else if (code === 302 || code === 401) {
      console.log('  ' + code + ' — 배포 보호(SSO)가 켜져 있다. 링크를 아무나 열려면 아래를 실행할 것.\n');
      console.log('  npx vercel project protection disable ai-builder-origin --sso --scope ' + SCOPE + '\n');
    } else {
      console.log('  응답 ' + code + ' — 잠시 뒤 https://' + ALIAS + ' 를 직접 확인할 것\n');
    }
  })();
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '');
  console.error('\n중단 — ' + (e.message || '').split('\n')[0]);
  if (out.trim()) console.error(out.trim());
  process.exit(1);
}
