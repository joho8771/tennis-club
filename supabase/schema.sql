-- 테니스 복식 랭킹 & 대진표 : Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run

create extension if not exists pgcrypto;

-- ───────── 테이블 ─────────
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  gender text not null default 'M' check (gender in ('M','F')),
  level int not null default 2 check (level between 1 and 5),
  active boolean not null default true,
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default '정기 모임',
  date date not null,
  start_time time not null default '17:00',
  courts int not null default 2 check (courts between 1 and 6),
  rounds int not null default 6 check (rounds between 1 and 12),
  round_minutes int not null default 30,
  deadline timestamptz,
  gender_mode text not null default 'balance' check (gender_mode in ('none','balance','mixed')),
  status text not null default 'open' check (status in ('open','generated','closed')),
  created_at timestamptz not null default now()
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  from_round int not null default 1,
  to_round int,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (session_id, member_id)
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  round int not null,
  court int not null,
  p1 uuid references members(id), p2 uuid references members(id),  -- 팀1
  p3 uuid references members(id), p4 uuid references members(id),  -- 팀2
  winner smallint check (winner in (1,2)),           -- 확정 결과 (랭킹 반영)
  score text,
  reported_winner smallint check (reported_winner in (1,2)),  -- 선수 입력 (승인 대기)
  reported_score text,
  reported_by text,
  reported_at timestamptz
);
create index if not exists matches_session_idx on matches(session_id);

create table if not exists adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  points int not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ───────── 권한 헬퍼 ─────────
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- 선수 결과 입력 (확정 전 경기에만, 신고 필드만 수정)
create or replace function report_result(p_match uuid, p_winner int, p_score text, p_reporter text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_winner not in (1,2) then raise exception 'invalid winner'; end if;
  update matches m
     set reported_winner = p_winner,
         reported_score = left(coalesce(p_score,''), 20),
         reported_by = left(coalesce(p_reporter,''), 20),
         reported_at = now()
   where m.id = p_match
     and m.winner is null
     and exists (select 1 from sessions s where s.id = m.session_id and s.status = 'generated');
end $$;
grant execute on function report_result(uuid,int,text,text) to anon, authenticated;

-- ───────── RLS ─────────
alter table members enable row level security;
alter table sessions enable row level security;
alter table registrations enable row level security;
alter table matches enable row level security;
alter table adjustments enable row level security;
alter table admins enable row level security;

-- 조회는 모두 공개
drop policy if exists r_members on members;           create policy r_members on members for select using (true);
drop policy if exists r_sessions on sessions;         create policy r_sessions on sessions for select using (true);
drop policy if exists r_regs on registrations;        create policy r_regs on registrations for select using (true);
drop policy if exists r_matches on matches;           create policy r_matches on matches for select using (true);
drop policy if exists r_adj on adjustments;           create policy r_adj on adjustments for select using (true);
drop policy if exists r_admins on admins;             create policy r_admins on admins for select using (user_id = auth.uid());

-- 관리자는 전부 쓰기
drop policy if exists w_members on members;           create policy w_members on members for all using (is_admin()) with check (is_admin());
drop policy if exists w_sessions on sessions;         create policy w_sessions on sessions for all using (is_admin()) with check (is_admin());
drop policy if exists w_regs on registrations;        create policy w_regs on registrations for all using (is_admin()) with check (is_admin());
drop policy if exists w_matches on matches;           create policy w_matches on matches for all using (is_admin()) with check (is_admin());
drop policy if exists w_adj on adjustments;           create policy w_adj on adjustments for all using (is_admin()) with check (is_admin());

-- 회원(익명 로그인 포함): 게스트 등록, 본인 신청/취소 (마감 전 + 접수중 세션만)
drop policy if exists guest_insert on members;
create policy guest_insert on members for insert to authenticated with check (is_guest = true);

drop policy if exists self_reg_insert on registrations;
create policy self_reg_insert on registrations for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from sessions s where s.id = session_id and s.status = 'open'
                and (s.deadline is null or now() < s.deadline))
  );

drop policy if exists self_reg_delete on registrations;
create policy self_reg_delete on registrations for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from sessions s where s.id = session_id and s.status = 'open')
  );

-- ───────── 실시간 ─────────
do $$ begin
  begin alter publication supabase_realtime add table sessions; exception when others then null; end;
  begin alter publication supabase_realtime add table registrations; exception when others then null; end;
  begin alter publication supabase_realtime add table matches; exception when others then null; end;
end $$;
