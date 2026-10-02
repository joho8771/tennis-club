/*
 * 랭킹 산정 (엑셀 MK1 점수 규칙)
 *   참석 +10 / 승리 +30 / 패배 0 / 한 모임에서 3경기 연속 출전 +5 (1회)
 *   + 관리자 점수 보정(adjustments: 엑셀 이관분, 이벤트 등)
 * 동점 처리: 승수 → 참석 수 → 이름
 */
(function (root) {
  'use strict';

  const RULES = { attend: 10, win: 30, loss: 0, streak3: 5 };

  const monthOf = (dateStr) => String(dateStr).slice(0, 7); // 'YYYY-MM'
  const quarterOf = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  };
  const yearOf = (ym) => ym.slice(0, 4);

  function periodMatch(period, ym) {
    if (!period || period === 'all') return true;
    if (/^\d{4}-\d{2}$/.test(period)) return ym === period;
    if (/^\d{4}-Q\d$/.test(period)) return quarterOf(ym) === period;
    if (/^\d{4}$/.test(period)) return yearOf(ym) === period;
    return false;
  }

  // 세션 단위 개인 점수
  function sessionScores(session, regs, matches) {
    const res = {};
    const ensure = (id) =>
      (res[id] = res[id] || { attend: 0, wins: 0, losses: 0, games: 0, streak: 0, rounds: [] });
    // 대진이 확정된 세션의 신청자 = 참석
    if (session.status !== 'open') {
      for (const r of regs) ensure(r.member_id).attend = 1;
    }
    for (const m of matches) {
      const t1 = [m.p1, m.p2], t2 = [m.p3, m.p4];
      for (const id of t1.concat(t2)) if (id) ensure(id).rounds.push(m.round);
      if (m.winner !== 1 && m.winner !== 2) continue;
      const win = m.winner === 1 ? t1 : t2;
      const lose = m.winner === 1 ? t2 : t1;
      for (const id of win) if (id) { ensure(id).wins++; res[id].games++; }
      for (const id of lose) if (id) { ensure(id).losses++; res[id].games++; }
    }
    for (const id in res) {
      const rs = [...new Set(res[id].rounds)].sort((a, b) => a - b);
      let run = 1, has3 = false;
      for (let i = 1; i < rs.length; i++) {
        run = rs[i] === rs[i - 1] + 1 ? run + 1 : 1;
        if (run >= 3) has3 = true;
      }
      res[id].streak = has3 ? 1 : 0;
      // 연속 보너스는 대진 확정 + 출전 기록 기준 (결과 입력 여부와 무관)
      if (session.status === 'open') res[id].streak = 0;
    }
    return res;
  }

  function compute({ members, sessions, registrations, matches, adjustments }, period) {
    const rows = {};
    const row = (id) =>
      (rows[id] = rows[id] || {
        id, attend: 0, wins: 0, losses: 0, games: 0, streak: 0, adj: 0, points: 0,
      });
    const regsBy = group(registrations, 'session_id');
    const matchesBy = group(matches, 'session_id');

    for (const s of sessions) {
      if (!periodMatch(period, monthOf(s.date))) continue;
      const sc = sessionScores(s, regsBy[s.id] || [], matchesBy[s.id] || []);
      for (const id in sc) {
        const r = row(id);
        r.attend += sc[id].attend;
        r.wins += sc[id].wins;
        r.losses += sc[id].losses;
        r.games += sc[id].games;
        r.streak += sc[id].streak;
      }
    }
    for (const a of adjustments || []) {
      if (!periodMatch(period, a.month)) continue;
      row(a.member_id).adj += Number(a.points) || 0;
    }
    const mmap = Object.fromEntries(members.map((m) => [m.id, m]));
    const list = Object.values(rows)
      .filter((r) => mmap[r.id])
      .map((r) => {
        r.points = r.attend * RULES.attend + r.wins * RULES.win + r.streak * RULES.streak3 + r.adj;
        r.name = mmap[r.id].name;
        r.winRate = r.games ? r.wins / r.games : null;
        return r;
      });
    list.sort(
      (a, b) =>
        b.points - a.points || b.wins - a.wins || b.attend - a.attend || a.name.localeCompare(b.name, 'ko')
    );
    // 공동 순위 (1,2,2,4)
    list.forEach((r, i) => {
      const p = list[i - 1];
      r.rank = p && p.points === r.points && p.wins === r.wins && p.attend === r.attend ? p.rank : i + 1;
    });
    return list;
  }

  function prevPeriod(period) {
    if (/^\d{4}-\d{2}$/.test(period)) {
      let [y, m] = period.split('-').map(Number);
      m--; if (m === 0) { m = 12; y--; }
      return `${y}-${String(m).padStart(2, '0')}`;
    }
    if (/^\d{4}-Q\d$/.test(period)) {
      let y = Number(period.slice(0, 4)), q = Number(period.slice(6));
      q--; if (q === 0) { q = 4; y--; }
      return `${y}-Q${q}`;
    }
    if (/^\d{4}$/.test(period)) return String(Number(period) - 1);
    return null;
  }

  // 랭킹 + 등락 + 시상 후보
  function withDelta(data, period) {
    const cur = compute(data, period);
    const prevKey = prevPeriod(period);
    const prev = prevKey ? compute(data, prevKey) : [];
    const prevRank = Object.fromEntries(prev.map((r) => [r.id, r.rank]));
    for (const r of cur) {
      r.prevRank = prevRank[r.id] || null;
      r.delta = r.prevRank ? r.prevRank - r.rank : null;
    }
    const awards = {};
    if (cur.length) {
      awards.top = cur.filter((r) => r.rank === 1).map((r) => r.id);
      const risers = cur.filter((r) => r.delta > 0);
      const maxRise = Math.max(0, ...risers.map((r) => r.delta));
      awards.riser = maxRise > 0 ? risers.filter((r) => r.delta === maxRise).map((r) => r.id) : [];
      const maxAtt = Math.max(...cur.map((r) => r.attend));
      const topAtt = cur.filter((r) => r.attend === maxAtt);
      // 다 같이 동률이면 의미 없으니 3명 이하일 때만 표시
      awards.attend = maxAtt > 0 && topAtt.length <= 3 ? topAtt.map((r) => r.id) : [];
    }
    return { list: cur, prevKey, awards };
  }

  function group(arr, key) {
    const g = {};
    for (const x of arr || []) (g[x[key]] = g[x[key]] || []).push(x);
    return g;
  }

  const api = { RULES, compute, withDelta, sessionScores, monthOf, quarterOf, prevPeriod, periodMatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ranking = api;
})(typeof window !== 'undefined' ? window : globalThis);
