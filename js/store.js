/*
 * 데이터 계층
 *  - config.js 에 Supabase 정보가 있으면 Supabase 모드
 *  - 없으면 데모 모드 (브라우저 localStorage, 비밀번호 없이 관리자 전환)
 */
(function (root) {
  'use strict';

  const TABLES = ['members', 'sessions', 'registrations', 'matches', 'adjustments'];
  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());

  // ───────── 데모 모드 ─────────
  function LocalStore() {
    const KEY = 'tennis_club_demo_v1';
    let db;
    const load = () => {
      try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
      if (!db) db = seedDemo();
    };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
    let me = null;
    try { me = localStorage.getItem(KEY + '_me'); } catch (e) {}
    if (!me) { me = uid(); try { localStorage.setItem(KEY + '_me', me); } catch (e) {} }
    let admin = false;
    try { admin = localStorage.getItem(KEY + '_admin') === '1'; } catch (e) {}
    load();

    return {
      mode: 'demo',
      async init() {},
      get userId() { return me; },
      get isAdmin() { return admin; },
      async login() { admin = true; try { localStorage.setItem(KEY + '_admin', '1'); } catch (e) {} },
      async logout() { admin = false; try { localStorage.removeItem(KEY + '_admin'); } catch (e) {} },
      async loadAll() { load(); return JSON.parse(JSON.stringify(db)); },
      async insert(table, rows) {
        const arr = (Array.isArray(rows) ? rows : [rows]).map((r) => ({
          id: uid(), created_at: new Date().toISOString(), ...r,
          ...(table === 'registrations' && !('user_id' in r) ? { user_id: me } : {}),
        }));
        if (table === 'members' && arr.some((r) => db.members.some((m) => m.name === r.name)))
          throw new Error('이미 같은 이름의 회원이 있어요');
        if (table === 'registrations' && arr.some((r) => db.registrations.some((x) => x.session_id === r.session_id && x.member_id === r.member_id)))
          throw new Error('이미 신청한 회원이에요');
        db[table].push(...arr); save(); return arr;
      },
      async update(table, id, patch) {
        const row = db[table].find((r) => r.id === id);
        if (row) Object.assign(row, patch);
        save(); return row;
      },
      async remove(table, id) { db[table] = db[table].filter((r) => r.id !== id); save(); },
      async removeWhere(table, col, val) { db[table] = db[table].filter((r) => r[col] !== val); save(); },
      async reportResult(matchId, winner, score, reporter) {
        const m = db.matches.find((x) => x.id === matchId);
        if (!m || m.winner) throw new Error('이미 확정된 경기예요');
        Object.assign(m, { reported_winner: winner, reported_score: score, reported_by: reporter, reported_at: new Date().toISOString() });
        save();
      },
      subscribe(cb) { window.addEventListener('storage', (e) => e.key === KEY && cb()); },
      resetDemo() { db = seedDemo(); save(); },
    };
  }

  function seedDemo() {
    const names = [
      ['재현','M',2,100],['종민','M',2,0],['시온','M',3,115],['동주','M',3,85],['준식','M',3,165],['현호','M',2,105],
      ['허찬','M',3,115],['상진','M',2,50],['진혁','M',2,100],['주훈','M',2,0],['민기','M',2,205],['하영','F',2,115],
      ['지수','F',2,120],['장미','F',2,175],['지인','F',1,115],['예린','F',1,175],
    ];
    const members = names.map(([name, gender, level]) => ({ id: uid(), name, gender, level, active: true, is_guest: false }));
    const adjustments = names
      .map(([name, , , pts], i) => pts ? { id: uid(), member_id: members[i].id, month: '2026-09', points: pts, note: '엑셀 MK1 이관' } : null)
      .filter(Boolean);
    const d = new Date(); d.setDate(d.getDate() + (((6 - d.getDay() + 7) % 7) || 7)); // 다음 토요일
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const session = {
      id: uid(), title: '토요 정기 모임', date, start_time: '17:00', courts: 2, rounds: 6, round_minutes: 30,
      deadline: date + 'T16:00:00+09:00', gender_mode: 'balance', status: 'open', created_at: new Date().toISOString(),
    };
    const regs = members.filter((m, i) => ![1, 2, 9, 14].includes(i)).map((m) => ({
      id: uid(), session_id: session.id, member_id: m.id, from_round: 1, to_round: null, user_id: 'seed',
    }));
    return { members, sessions: [session], registrations: regs, matches: [], adjustments };
  }

  // ───────── Supabase 모드 ─────────
  function SupaStore(url, key) {
    const sb = root.supabase.createClient(url, key, { auth: { persistSession: true } });
    let user = null;
    let admin = false;

    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

    async function refreshAdmin() {
      admin = false;
      if (user && !user.is_anonymous) {
        const { data } = await sb.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
        admin = !!data;
      }
    }

    return {
      mode: 'supabase',
      async init() {
        const { data } = await sb.auth.getSession();
        user = data.session?.user || null;
        if (!user) {
          // 회원은 로그인 없이: 익명 세션으로 본인 신청/취소 식별
          const r = await sb.auth.signInAnonymously();
          if (!r.error) user = r.data.user;
        }
        await refreshAdmin();
      },
      get userId() { return user?.id || null; },
      get isAdmin() { return admin; },
      async login(email, password) {
        const r = await sb.auth.signInWithPassword({ email, password });
        if (r.error) throw new Error('로그인 실패: ' + r.error.message);
        user = r.data.user; await refreshAdmin();
        if (!admin) throw new Error('관리자 권한이 없는 계정이에요');
      },
      async logout() {
        await sb.auth.signOut(); user = null; admin = false;
        const r = await sb.auth.signInAnonymously(); if (!r.error) user = r.data.user;
      },
      async loadAll() {
        const out = {};
        await Promise.all(TABLES.map(async (t) => {
          let q = sb.from(t).select('*');
          if (t === 'sessions') q = q.order('date', { ascending: false });
          out[t] = ok(await q.limit(5000));
        }));
        return out;
      },
      async insert(table, rows) { return ok(await sb.from(table).insert(rows).select()); },
      async update(table, id, patch) { return ok(await sb.from(table).update(patch).eq('id', id).select()); },
      async remove(table, id) { ok(await sb.from(table).delete().eq('id', id)); },
      async removeWhere(table, col, val) { ok(await sb.from(table).delete().eq(col, val)); },
      async reportResult(matchId, winner, score, reporter) {
        ok(await sb.rpc('report_result', { p_match: matchId, p_winner: winner, p_score: score, p_reporter: reporter }));
      },
      subscribe(cb) {
        let t;
        const debounced = () => { clearTimeout(t); t = setTimeout(cb, 400); };
        sb.channel('club')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, debounced)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, debounced)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, debounced)
          .subscribe();
      },
    };
  }

  root.createStore = function () {
    const c = root.CLUB_CONFIG || {};
    if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY && root.supabase) return SupaStore(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    return LocalStore();
  };
})(window);
