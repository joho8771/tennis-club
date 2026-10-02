/*
 * 복식 대진 생성 알고리즘
 * 우선순위 (엑셀 MK1 원칙 계승)
 *   1. 경기 수 균등 (가용 라운드 대비)
 *   2. 휴식 로테이션 (연속 휴식/연속 과다 출전 방지)
 *   3. 실력 균형 (팀 전력 차 최소화 → 상위+하위 혼합 파트너)
 *   4. 파트너/상대 반복 최소화 (오늘 + 과거 이력)
 *   5. 성별 구성 (none | balance: 양 팀 성비 동일 | mixed: 혼복 우선)
 */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  const W = {
    partnerToday: 60,
    partnerHist: 4,
    oppToday: 9,
    oppHist: 0.6,
    balance: 12,
    genderBalance: 25,
    mixedPrefer: 8,
  };

  function matchCost(q, ctx) {
    // q = [a, b, c, d] → 팀1 (a,b) vs 팀2 (c,d)
    const [a, b, c, d] = q;
    const { today, hist, pmap, genderMode } = ctx;
    let cost = 0;
    for (const [x, y] of [[a, b], [c, d]]) {
      const k = pairKey(x, y);
      cost += (today.partner[k] || 0) * W.partnerToday;
      cost += (hist.partner[k] || 0) * W.partnerHist;
    }
    for (const x of [a, b]) {
      for (const y of [c, d]) {
        const k = pairKey(x, y);
        cost += (today.opp[k] || 0) * W.oppToday;
        cost += (hist.opp[k] || 0) * W.oppHist;
      }
    }
    const s1 = pmap[a].strength + pmap[b].strength;
    const s2 = pmap[c].strength + pmap[d].strength;
    cost += Math.abs(s1 - s2) * W.balance;
    // 파트너끼리 실력 차가 너무 크거나(상위+상위 vs 하위+하위) 하는 경우는 balance 항이 처리
    if (genderMode !== 'none') {
      const f1 = (pmap[a].gender === 'F') + (pmap[b].gender === 'F');
      const f2 = (pmap[c].gender === 'F') + (pmap[d].gender === 'F');
      if (f1 !== f2) cost += W.genderBalance * Math.abs(f1 - f2);
      if (genderMode === 'mixed') {
        if (f1 !== 1) cost += W.mixedPrefer;
        if (f2 !== 1) cost += W.mixedPrefer;
      }
    }
    return cost;
  }

  function permCost(perm, ctx) {
    let c = 0;
    for (let i = 0; i < perm.length; i += 4) c += matchCost(perm.slice(i, i + 4), ctx);
    return c;
  }

  // 선택된 인원을 n개 코트 × (2 vs 2)로 나누는 로컬 서치
  function arrange(selected, ctx, rnd) {
    let best = null;
    let bestCost = Infinity;
    const restarts = selected.length <= 8 ? 12 : 20;
    for (let r = 0; r < restarts; r++) {
      const perm = shuffle(selected.slice(), rnd);
      let cur = permCost(perm, ctx);
      let improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < perm.length; i++) {
          for (let j = i + 1; j < perm.length; j++) {
            // 같은 팀 내부 스왑은 의미 없음
            if (Math.floor(i / 2) === Math.floor(j / 2)) continue;
            [perm[i], perm[j]] = [perm[j], perm[i]];
            const c = permCost(perm, ctx);
            if (c + 1e-9 < cur) {
              cur = c;
              improved = true;
            } else {
              [perm[i], perm[j]] = [perm[j], perm[i]];
            }
          }
        }
      }
      if (cur < bestCost) {
        bestCost = cur;
        best = perm.slice();
      }
    }
    return { perm: best, cost: bestCost };
  }

  function buildOnce(input, rnd) {
    const { players, courts, rounds, genderMode } = input;
    const hist = input.history || { partner: {}, opp: {} };
    const pmap = Object.fromEntries(players.map((p) => [p.id, p]));
    const today = { partner: {}, opp: {} };
    const games = Object.fromEntries(players.map((p) => [p.id, 0]));
    const availSoFar = Object.fromEntries(players.map((p) => [p.id, 0]));
    const lastPlayed = {}; // id → 마지막 출전 라운드
    const streak = Object.fromEntries(players.map((p) => [p.id, 0])); // 연속 출전 수
    const restStreak = Object.fromEntries(players.map((p) => [p.id, 0]));
    const out = [];
    let total = 0;

    for (let r = 1; r <= rounds; r++) {
      const avail = players.filter((p) => (p.from || 1) <= r && r <= (p.to || rounds));
      avail.forEach((p) => availSoFar[p.id]++);
      const nMatch = Math.min(courts, Math.floor(avail.length / 4));
      const need = nMatch * 4;

      // 출전 우선순위: 가용 대비 출전 비율 낮은 순 → 연속 휴식 많은 순 → 연속 출전 적은 순 → 랜덤
      const keyed = avail.map((p) => ({
        id: p.id,
        ratio: games[p.id] / Math.max(1, availSoFar[p.id]),
        g: games[p.id],
        rest: restStreak[p.id],
        streak: streak[p.id],
        rnd: rnd(),
      }));
      keyed.sort(
        (x, y) =>
          x.ratio - y.ratio || x.g - y.g || y.rest - x.rest || x.streak - y.streak || x.rnd - y.rnd
      );
      const selected = keyed.slice(0, need).map((k) => k.id);
      const resting = keyed.slice(need).map((k) => k.id);

      const ctx = { today, hist, pmap, genderMode };
      const { perm, cost } = need ? arrange(selected, ctx, rnd) : { perm: [], cost: 0 };
      total += cost;

      const matches = [];
      for (let i = 0; i < perm.length; i += 4) {
        const [a, b, c, d] = perm.slice(i, i + 4);
        matches.push({ court: i / 4 + 1, t1: [a, b], t2: [c, d] });
        today.partner[pairKey(a, b)] = (today.partner[pairKey(a, b)] || 0) + 1;
        today.partner[pairKey(c, d)] = (today.partner[pairKey(c, d)] || 0) + 1;
        for (const x of [a, b]) for (const y of [c, d]) {
          const k = pairKey(x, y);
          today.opp[k] = (today.opp[k] || 0) + 1;
        }
      }
      for (const id of selected) {
        games[id]++;
        streak[id] = lastPlayed[id] === r - 1 ? streak[id] + 1 : 1;
        restStreak[id] = 0;
        lastPlayed[id] = r;
      }
      for (const id of resting) {
        streak[id] = 0;
        restStreak[id]++;
      }
      // 4연속 이상 출전 / 2연속 이상 휴식에 페널티 (가능한 한 피함)
      for (const id of selected) if (streak[id] >= 4) total += 6;
      for (const id of resting) if (restStreak[id] >= 2) total += 8;
      out.push({ round: r, matches, rest: resting });
    }

    // 공정성: 전 라운드 가용 인원 사이의 경기 수 편차
    const full = players.filter((p) => (p.from || 1) === 1 && (p.to || rounds) === rounds);
    if (full.length) {
      const gs = full.map((p) => games[p.id]);
      total += (Math.max(...gs) - Math.min(...gs)) * 200;
    }
    return { rounds: out, games, cost: total };
  }

  function generate(input) {
    const seed = input.seed != null ? input.seed : Date.now();
    const rnd = mulberry32(seed);
    const attempts = input.attempts || 30;
    let best = null;
    for (let i = 0; i < attempts; i++) {
      const res = buildOnce(input, rnd);
      if (!best || res.cost < best.cost) best = res;
    }
    best.seed = seed;
    return best;
  }

  // 과거 경기 목록 → 이력 맵
  function buildHistory(pastMatches) {
    const h = { partner: {}, opp: {} };
    for (const m of pastMatches) {
      const t1 = [m.p1, m.p2], t2 = [m.p3, m.p4];
      if (t1.concat(t2).some((x) => !x)) continue;
      h.partner[pairKey(t1[0], t1[1])] = (h.partner[pairKey(t1[0], t1[1])] || 0) + 1;
      h.partner[pairKey(t2[0], t2[1])] = (h.partner[pairKey(t2[0], t2[1])] || 0) + 1;
      for (const x of t1) for (const y of t2) h.opp[pairKey(x, y)] = (h.opp[pairKey(x, y)] || 0) + 1;
    }
    return h;
  }

  const api = { generate, buildHistory, pairKey, matchCost, _mulberry32: mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof window !== 'undefined' ? window : globalThis);
