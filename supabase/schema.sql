-- AI Builder Origin — Supabase 초기 스키마
--
-- 실행: Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run.
-- 여러 번 실행해도 안전하도록 짰다(if not exists / drop policy if exists).
--
-- ⚠️ 이 파일은 실제 Supabase 에서 실행해 검증하지 못했다(프로젝트가 없었다).
--    처음 실행할 때 오류가 나면 그 지점부터 고쳐 나가면 된다.
--
-- 근거: docs/TRD_v1.0.md §3(데이터 모델) · §4(인증·권한) · §5(워크플로)

-- ═══════════════════════════════════════════════════════════════
-- 1. 프로필
-- ═══════════════════════════════════════════════════════════════
-- auth.users 를 직접 건드리지 않는다. 역할·소개 같은 서비스 정보는 이쪽에 둔다.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  name          text,
  role          text,                                   -- 기획 · UI/UX 등 (표시용)
  bio           text,
  photo_url     text,
  account_role  text not null default 'builder',        -- builder | admin
  status        text not null default 'active',         -- active | invited | inactive
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_account_role_chk check (account_role in ('builder','admin')),
  constraint profiles_status_chk       check (status in ('active','invited','inactive')),
  -- 한 줄 소개는 공개 카드에 그대로 나간다. 길이를 막지 않으면 카드가 줄바꿈으로 깨진다.
  constraint profiles_bio_len_chk      check (bio is null or char_length(bio) <= 70)
);

-- 가입하면 프로필을 자동으로 만든다. 앱에서 만들면 한 경로만 빠뜨려도 프로필 없는 계정이 생긴다.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, photo_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- 2. 콘텐츠
-- ═══════════════════════════════════════════════════════════════
create table if not exists public.posts (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,                         -- work | insight
  slug           text not null unique,                  -- 주소가 된다. 한 번 정하면 바꾸지 않는다
  title          text not null,
  lead           text,
  body           jsonb not null default '[]'::jsonb,     -- [[소제목, 문단, [목록]], ...]
  cover_url      text,
  type           text,                                  -- insight 분류 (Working method 등)
  client         text,                                  -- work
  author_id      uuid references public.profiles(id) on delete set null,
  status         text not null default 'draft',         -- draft | review | live
  reject_reason  text,
  published_by   uuid references public.profiles(id) on delete set null,
  published_at   timestamptz,
  sort_date      date not null default current_date,    -- 목록 정렬 기준(표시 날짜)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint posts_kind_chk   check (kind   in ('work','insight')),
  constraint posts_status_chk check (status in ('draft','review','live'))
);

-- author_id 를 on delete set null 로 둔 이유: 계정을 지워도 글은 남아야 한다.
-- 다만 운영에서는 계정을 지우지 않고 status='inactive' 로 둔다(TRD §3).

create index if not exists posts_kind_status_idx on public.posts (kind, status, sort_date desc);
create index if not exists posts_author_idx      on public.posts (author_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. updated_at 자동 갱신
-- ═══════════════════════════════════════════════════════════════
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 4. 발행 기록
-- ═══════════════════════════════════════════════════════════════
-- "결정과 변경이 기록으로 남는가"가 이 사이트가 파는 메시지다. 앱이 채우게 두면 빠뜨린다.
create or replace function public.stamp_publish()
returns trigger language plpgsql as $$
begin
  if new.status = 'live' and coalesce(old.status,'') <> 'live' then
    new.published_by := auth.uid();
    new.published_at := now();
    new.reject_reason := null;              -- 공개됐으면 지난 반려 사유는 남기지 않는다
  end if;
  return new;
end $$;

drop trigger if exists posts_stamp_publish on public.posts;
create trigger posts_stamp_publish before update on public.posts
  for each row execute function public.stamp_publish();

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS
-- ═══════════════════════════════════════════════════════════════
-- 🔴 권한 판정을 앱 코드에 두지 않는다. 한 곳만 빠뜨려도 새어나간다(TRD §4.2).

alter table public.profiles enable row level security;
alter table public.posts    enable row level security;

-- 관리자 판정을 함수로 뺀다. 정책 안에서 profiles 를 직접 조회하면
-- profiles 자신의 정책과 재귀가 걸린다 — security definer 로 끊는다.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_role = 'admin' and status = 'active'
  );
$$;

-- ── profiles ──────────────────────────────────────────────────
drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_insert on public.profiles;

-- 공개 사이트의 빌더 카드가 읽어야 하므로 활동 중인 프로필은 누구나 본다.
create policy profiles_read on public.profiles for select
  using (status = 'active' or id = auth.uid() or public.is_admin());

-- 자기 프로필만 고친다. 역할·계정 상태는 관리자만 — 스스로 관리자가 되는 길을 막는다.
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (id = auth.uid()
        and account_role = (select account_role from public.profiles p where p.id = auth.uid())
        and status       = (select status       from public.profiles p where p.id = auth.uid()))
  );

create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid() or public.is_admin());

-- ── posts ─────────────────────────────────────────────────────
drop policy if exists posts_read           on public.posts;
drop policy if exists posts_insert_own     on public.posts;
drop policy if exists posts_update_own     on public.posts;
drop policy if exists posts_update_admin   on public.posts;
drop policy if exists posts_delete_admin   on public.posts;

-- 공개된 것은 누구나. 그 외에는 작성자와 관리자만.
create policy posts_read on public.posts for select
  using (status = 'live' or author_id = auth.uid() or public.is_admin());

-- 만들 때는 자기 이름으로, 초안으로만.
create policy posts_insert_own on public.posts for insert
  with check (author_id = auth.uid() and status = 'draft');

-- 🔴 상태 전이 제한이 핵심이다.
--    using      = 어떤 행을 건드릴 수 있는가
--    with check = 바꾼 뒤의 값이 허용되는가
-- 빌더는 자기 글을 draft ↔ review 까지만. live 로는 못 올린다.
create policy posts_update_own on public.posts for update
  using (author_id = auth.uid() and status in ('draft','review'))
  with check (author_id = auth.uid() and status in ('draft','review'));

create policy posts_update_admin on public.posts for update
  using (public.is_admin()) with check (public.is_admin());

-- 삭제는 관리자만. 빌더가 지우면 공개된 글이 조용히 사라진다.
create policy posts_delete_admin on public.posts for delete
  using (public.is_admin());

-- ═══════════════════════════════════════════════════════════════
-- 6. 아바타 저장소
-- ═══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_read   on storage.objects;
drop policy if exists avatars_write  on storage.objects;
drop policy if exists avatars_update on storage.objects;

create policy avatars_read on storage.objects for select
  using (bucket_id = 'avatars');

-- 파일 이름을 "<uid>/..." 로 두고 자기 폴더만 쓰게 한다.
create policy avatars_write on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════════════════════
-- 7. 첫 관리자 지정
-- ═══════════════════════════════════════════════════════════════
-- 한 번 로그인해서 profiles 행이 생긴 뒤에 실행한다.
-- 관리자는 최소 2명을 둔다 — 보안이 아니라 운영 연속성 문제다(TRD §4.1).
--
--   update public.profiles set account_role = 'admin'
--   where email in ('you@company.com', 'teammate@company.com');
--
-- 확인:
--   select email, account_role, status from public.profiles order by created_at;
