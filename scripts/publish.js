#!/usr/bin/env node
/*
 * 검사 → 배포 폴더 생성 → Vercel 배포 → 별칭 연결 → 접속 확인까지 한 번에.
 * 실행: node scripts/publish.js
 *
 * 왜 스크립트로 묶는가
 *   손으로 하면 세 명령을 순서대로 쳐야 하는데, 마지막 alias 를 빠뜨리면 배포는 됐는데
 *   공유한 링크는 예전 화면을 가리킨다. 아무도 눈치채지 못한 채 옛 시안을 보게 된다.
 *
 * 왜 프로젝트를 ID 로 고정하는가  ← 2026-08-08 사고
 *   `vercel deploy deploy` 는 대상 폴더 이름을 프로젝트 이름으로 쓴다.
 *   프로젝트를 ai-builder-origin 으로 rename 한 뒤 다시 배포했더니 CLI 가 `deploy` 라는
 *   프로젝트를 새로 만들어 그쪽에 올렸다. 배포 보호를 계속 껐는데도 링크가 안 열린 이유가
 *   이것이다 — 껐던 쪽은 빈 프로젝트였고, 별칭이 가리키는 배포는 새 프로젝트에 있었다.
 *   원인을 찾는 데 여러 시간이 걸렸다. 이제 project.json 을 미리 써서 대상을 못 바꾸게 한다.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'deploy');
const SCOPE = 'builderschool';
const ALIAS = 'ai-builder-origin.vercel.app';

/* 이름이 아니라 ID 로 묶는다. 이름은 대시보드에서 언제든 바뀔 수 있다. */
const PROJECT_NAME = 'deploy';
const PROJECT_ID = 'prj_USlDaGYa24hgsy5WpDLwvqhAmHCz';
const ORG_ID = 'team_KkK39p0sN6DHyPZlDgo9r40P';

/* Windows 의 npx 는 .cmd 라 shell 없이는 실행되지 않는다(Node 24 부터 EINVAL).
   그래서 shell:true 가 필요하고, 그 대가로 deprecation 경고가 뜬다.
   여기서 넘기는 인자는 전부 이 파일 안에 적힌 상수와 CLI 가 돌려준 배포 URL 뿐이라
   외부 입력이 섞이지 않는다 — 경고만 끄고 쓴다. */
process.noDeprecation = true;
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: true, ...opts });

const step = m => console.log('\n▸ ' + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hit = () => new Promise(res => {
  https.get('https://' + ALIAS + '/', r => { r.resume(); res(r.statusCode); })
    .on('error', () => res(0));
});

(async () => {
  try {
    step('파일 검사');
    console.log(run('node', ['scripts/check.js'], { stdio: 'pipe' }).trim());

    step('배포 폴더 생성');
    run('node', ['scripts/make-deploy.js'], { stdio: 'pipe' });
    /* make-deploy 가 deploy/ 를 매번 지우고 다시 만들므로 링크 파일도 매번 써준다.
       이게 없으면 CLI 가 폴더 이름으로 새 프로젝트를 만든다. */
    fs.mkdirSync(path.join(OUT, '.vercel'), { recursive: true });
    fs.writeFileSync(path.join(OUT, '.vercel', 'project.json'),
      JSON.stringify({ projectId: PROJECT_ID, orgId: ORG_ID }, null, 2) + '\n');
    console.log('  deploy/ 준비 완료 · 프로젝트 고정 ' + PROJECT_NAME);

    step('Vercel 배포');
    const out = run('npx', ['vercel', 'deploy', 'deploy', '--prod', '--yes', '--scope', SCOPE], { stdio: 'pipe' });
    const urls = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g) || [];
    const deployed = urls.filter(u => !u.includes(ALIAS)).pop();
    if (!deployed) { console.error('  배포 URL 을 찾지 못했다. 아래 출력을 확인할 것.\n' + out); process.exit(1); }
    console.log('  ' + deployed);

    step('별칭 연결');
    run('npx', ['vercel', 'alias', 'set', deployed, ALIAS, '--scope', SCOPE], { stdio: 'pipe' });
    console.log('  ' + ALIAS + ' → ' + deployed);

    step('접속 확인');
    let code = 0;
    for (let i = 0; i < 5; i++) { code = await hit(); if (code === 200) break; await sleep(4000); }

    /* 새 배포마다 팀 기본값(보호 켜짐)을 상속하는 경우가 있다. 시안은 팀원이 링크로 봐야 하므로
       막혀 있으면 여기서 풀고 다시 확인한다. 조용히 넘기지 않고 로그에 남긴다. */
    if (code !== 200) {
      console.log('  ' + code + ' — 배포 보호가 켜져 있다. ' + PROJECT_NAME + ' 프로젝트에서 해제한다.');
      run('npx', ['vercel', 'project', 'protection', 'disable', PROJECT_NAME, '--sso', '--scope', SCOPE], { stdio: 'pipe' });
      for (let i = 0; i < 5; i++) { await sleep(4000); code = await hit(); if (code === 200) break; }
    }

    if (code === 200) {
      console.log('  200 OK — 로그인 없이 열린다\n');
      console.log('공유 링크  https://' + ALIAS + '\n');
    } else {
      console.log('  응답 ' + code + ' — 아직 막혀 있다. 프로젝트가 갈라졌는지 확인할 것:\n');
      console.log('  npx vercel project ls --scope ' + SCOPE);
      console.log('  (별칭이 가리키는 배포가 어느 프로젝트에 속하는지 봐야 한다)\n');
    }
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    console.error('\n중단 — ' + (e.message || '').split('\n')[0]);
    if (out.trim()) console.error(out.trim());
    process.exit(1);
  }
})();
