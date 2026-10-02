// node test/scheduler.test.js
const S = require('../js/scheduler.js');
const R = require('../js/ranking.js');
const assert = require('assert');

function mkPlayers(n, opts = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'p' + (i + 1),
    gender: i % 3 === 0 ? 'F' : 'M',
    strength: 1 + (i % 3) + (opts.jitter ? i * 0.01 : 0),
    from: 1,
    to: opts.rounds || 6,
  }));
}

function check(name, input) {
  const res = S.generate({ attempts: 30, seed: 42, ...input });
  const { players, courts, rounds } = input;
  const partner = {};
  let maxPartnerRepeat = 0;
  for (const rd of res.rounds) {
    const seen = new Set();
    for (const m of rd.matches) {
      for (const id of [...m.t1, ...m.t2]) {
        assert(!seen.has(id), `${name}: R${rd.round} 중복 출전 ${id}`);
        seen.add(id);
        const p = players.find((x) => x.id === id);
        assert(p.from <= rd.round && rd.round <= p.to, `${name}: 가용 외 출전 ${id}`);
      }
      for (const t of [m.t1, m.t2]) {
        const k = S.pairKey(t[0], t[1]);
        partner[k] = (partner[k] || 0) + 1;
        maxPartnerRepeat = Math.max(maxPartnerRepeat, partner[k]);
      }
    }
    for (const id of rd.rest) assert(!seen.has(id));
    const avail = players.filter((p) => p.from <= rd.round && rd.round <= p.to).length;
    assert.strictEqual(rd.matches.length, Math.min(courts, Math.floor(avail / 4)), `${name}: 코트 수`);
  }
  const full = players.filter((p) => p.from === 1 && p.to === rounds).map((p) => res.games[p.id]);
  const spread = Math.max(...full) - Math.min(...full);
  console.log(
    `${name.padEnd(28)} games ${Math.min(...full)}~${Math.max(...full)} (spread ${spread})  maxPartner ${maxPartnerRepeat}  cost ${res.cost.toFixed(1)}`
  );
  assert(spread <= 1, `${name}: 경기 수 편차 ${spread}`);
  return res;
}

for (let n = 8; n <= 16; n++) check(`${n}명 2코트 6R`, { players: mkPlayers(n), courts: 2, rounds: 6, genderMode: 'none' });
check('12명 3코트 6R', { players: mkPlayers(12), courts: 3, rounds: 6, genderMode: 'none' });
check('14명 3코트 8R mixed', { players: mkPlayers(14, { rounds: 8 }), courts: 3, rounds: 8, genderMode: 'mixed' });
check('5명 1코트 4R', { players: mkPlayers(5, { rounds: 4 }), courts: 1, rounds: 4, genderMode: 'none' });

// 지각/조퇴
const late = mkPlayers(11);
late[0].from = 3; late[1].to = 4; late[2].from = 2; late[2].to = 5;
check('11명 지각/조퇴 포함', { players: late, courts: 2, rounds: 6, genderMode: 'balance' });

// 랭킹
const data = {
  members: [{ id: 'a', name: '가' }, { id: 'b', name: '나' }, { id: 'c', name: '다' }, { id: 'd', name: '라' }, { id: 'e', name: '마' }],
  sessions: [{ id: 's1', date: '2026-09-05', status: 'closed' }, { id: 's2', date: '2026-10-03', status: 'generated' }],
  registrations: ['a', 'b', 'c', 'd', 'e'].map((m) => ({ session_id: 's1', member_id: m })).concat(
    ['a', 'b', 'c', 'd'].map((m) => ({ session_id: 's2', member_id: m }))),
  matches: [
    { session_id: 's1', round: 1, p1: 'a', p2: 'b', p3: 'c', p4: 'd', winner: 1 },
    { session_id: 's1', round: 2, p1: 'a', p2: 'c', p3: 'b', p4: 'e', winner: 2 },
    { session_id: 's1', round: 3, p1: 'a', p2: 'd', p3: 'c', p4: 'e', winner: 1 },
    { session_id: 's2', round: 1, p1: 'a', p2: 'b', p3: 'c', p4: 'd', winner: 2 },
    { session_id: 's2', round: 2, p1: 'a', p2: 'c', p3: 'b', p4: 'd', winner: null, reported_winner: 1 },
  ],
  adjustments: [{ member_id: 'e', month: '2026-09', points: 100 }],
};
const sep = R.compute(data, '2026-09');
const get = (l, id) => l.find((r) => r.id === id);
// a: 참석10 + 2승60 + 3연속5 = 75
assert.strictEqual(get(sep, 'a').points, 75);
// e: 참석10 + 1승30 + 보정100 = 140 (R2,R3 연속 2경기 → 보너스 없음)
assert.strictEqual(get(sep, 'e').points, 140);
assert.strictEqual(sep[0].id, 'e');
const oct = R.withDelta(data, '2026-10');
// 승인 전 결과(reported_winner)는 반영 안 됨
assert.strictEqual(get(oct.list, 'c').wins, 1);
assert.strictEqual(R.compute(data, '2026-Q3').length, 5);
console.log('ranking ok', oct.list.map((r) => `${r.name}:${r.points}(${r.delta})`).join(' '));
console.log('ALL PASS');
