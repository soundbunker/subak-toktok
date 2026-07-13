-- ─────────────────────────────────────────────────────────────
-- 수박톡톡 Supabase 초기 설정
-- 사용법: Supabase 대시보드 > SQL Editor > 붙여넣고 Run
-- ─────────────────────────────────────────────────────────────

-- 관리자 판별: 이 이메일로 로그인한 사용자만 통계·소리 열람 가능
create or replace function is_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt()->>'email', '') = 'jejuwatch@gmail.com'
$$;

-- ── 방문 기록 ──
create table if not exists visits (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  device text
);
alter table visits enable row level security;
create policy "anyone can log a visit" on visits
  for insert to anon, authenticated with check (true);
create policy "admin can read visits" on visits
  for select to authenticated using (is_admin());

-- ── 타격(측정) 기록 ──
create table if not exists taps (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  freq int,
  grade text,
  pct int,
  audio_path text,
  device text
);
alter table taps enable row level security;
create policy "anyone can log a tap" on taps
  for insert to anon, authenticated with check (true);
create policy "admin can read taps" on taps
  for select to authenticated using (is_admin());

-- ── 공개 카운터 (메인 페이지의 "두드려본 수박 N개") ──
create or replace function public_counts() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'visits', (select count(*) from visits),
    'taps',   (select count(*) from taps),
    'sounds', (select count(*) from taps where audio_path is not null)
  )
$$;
grant execute on function public_counts() to anon, authenticated;

-- ── 관리자 통계 ──
create or replace function admin_stats() returns json
language sql stable security definer set search_path = public as $$
  select case when is_admin() then json_build_object(
    'visits_total', (select count(*) from visits),
    'visits_today', (select count(*) from visits where ts::date = current_date),
    'devices',      (select count(distinct device) from visits),
    'taps_total',   (select count(*) from taps),
    'taps_today',   (select count(*) from taps where ts::date = current_date),
    'sounds_total', (select count(*) from taps where audio_path is not null)
  ) end
$$;
revoke execute on function admin_stats() from public, anon;
grant execute on function admin_stats() to authenticated;

-- ── 일별 통계 (최근 30일) ──
create or replace function admin_daily() returns table(day date, visits bigint, taps bigint)
language sql stable security definer set search_path = public as $$
  select d::date,
         (select count(*) from visits v where v.ts::date = d::date),
         (select count(*) from taps  t where t.ts::date = d::date)
  from generate_series(current_date - 29, current_date, interval '1 day') d
  where is_admin()
  order by 1 desc
$$;
revoke execute on function admin_daily() from public, anon;
grant execute on function admin_daily() to authenticated;

-- ── 월별 통계 (최근 12개월) ──
create or replace function admin_monthly() returns table(month text, visits bigint, taps bigint)
language sql stable security definer set search_path = public as $$
  select to_char(m, 'YYYY-MM'),
         (select count(*) from visits v where date_trunc('month', v.ts) = m),
         (select count(*) from taps  t where date_trunc('month', t.ts) = m)
  from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
  where is_admin()
  order by 1 desc
$$;
revoke execute on function admin_monthly() from public, anon;
grant execute on function admin_monthly() to authenticated;

-- ── 타격음 저장 버킷 ──
insert into storage.buckets (id, name, public) values ('taps', 'taps', false)
on conflict (id) do nothing;
create policy "anyone can upload tap sounds" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'taps');
create policy "admin can listen tap sounds" on storage.objects
  for select to authenticated using (bucket_id = 'taps' and is_admin());
