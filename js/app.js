(function () {
  'use strict';

  const store = window.createStore();
  const CFG = window.CLUB_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    tab: 'session',
    data: { members: [], sessions: [], registrations: [], matches: [], adjustments: [] },
    sessionId: null,
    period: null, // 'YYYY-MM' | 'YYYY-Qn' | 'YYYY' | 'all'
    periodType: 'month',
    swapMode: false,
    swapSel: null,
  };
  const GENDER_MODE = { none: '성별 무관', balance: '양 팀 성비 맞춤', mixed: '혼복 우선' };

  // ───────── 유틸 ─────────
  const mmap = () => Object.fromEntries(state.data.members.map((m) => [m.id, m]));
  const nameOf = (id) => mmap()[id]?.name || '?';
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmtDate = (s) => {
    const d = new Date(s + 'T00:00:00');
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
  };
  const hhmm = (t) => String(t || '').slice(0, 5);
  function roundTime(s, r) {
    const [h, m] = hhmm(s.start_time).split(':').map(Number);
    const st = h * 60 + m + (r - 1) * s.round_minutes;
    const f = (x) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    return `${f(st)}-${f(st + s.round_minutes)}`;
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  }
  function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
  const sessionById = (id) => state.data.sessions.find((s) => s.id === id);
  const regsOf = (sid) => state.data.registrations.filter((r) => r.session_id === sid)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const matchesOf = (sid) => state.data.matches.filter((m) => m.session_id === sid)
    .sort((a, b) => a.round - b.round || a.court - b.court);
  const memberLabel = (m) => `${esc(m.name)} <span class="g-${m.gender}">${m.gender === 'M' ? '남' : '여'}</span> <span class="lv">Lv${m.level}</span>`;

  function pickDefaultSession() {
    const ss = state.data.sessions.slice().sort((a, b) => a.date.localeCompare(b.date));
    const today = todayStr();
    return (ss.find((s) => s.date >= today && s.status !== 'closed') ||
            ss.filter((s) => s.status !== 'closed').pop() || ss[ss.length - 1] || null)?.id || null;
  }

  async function reload() {
    try {
      state.data = await store.loadAll();
    } catch (e) {
      toast('불러오기 실패: ' + e.message);
    }
    if (!sessionById(state.sessionId)) state.sessionId = pickDefaultSession();
    render();
  }

  async function act(fn, okMsg) {
    try {
      await fn();
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(e.message || String(e));
    }
    await reload();
  }

  // ───────── 렌더 ─────────
  function render() {
    $('#clubName').textContent = CFG.CLUB_NAME || '테니스 클럽';
    $('#modeBadge').textContent = (store.mode === 'demo' ? '데모' : '') + (store.isAdmin ? (store.mode === 'demo' ? ' · ' : '') + '관리자' : '');
    $('#modeBadge').hidden = !$('#modeBadge').textContent;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    const v = $('#view');
    if (state.tab === 'session') v.innerHTML = viewSession();
    else if (state.tab === 'ranking') v.innerHTML = viewRanking();
    else if (state.tab === 'history') v.innerHTML = viewHistory();
    else v.innerHTML = viewAdmin();
  }

  // ── 모임 탭 ──
  function viewSession() {
    const s = sessionById(state.sessionId);
    if (!s) {
      return `<div class="card empty">아직 만들어진 모임이 없어요.<br/>${store.isAdmin ? '<button class="btn primary" data-goto="admin" style="margin-top:12px">모임 만들기</button>' : '관리자가 모임을 열면 여기서 신청할 수 있어요.'}</div>`;
    }
    const regs = regsOf(s.id);
    const statusTxt = { open: '접수중', generated: '대진 확정', closed: '종료' }[s.status];
    const dl = s.deadline ? new Date(s.deadline) : null;
    const dlTxt = dl ? `신청 마감 ${dl.getMonth() + 1}/${dl.getDate()} ${String(dl.getHours()).padStart(2, '0')}:${String(dl.getMinutes()).padStart(2, '0')}` : '';
    const options = state.data.sessions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)
      .map((x) => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${x.date} ${esc(x.title)}</option>`).join('');

    let html = `
      <div class="card hero">
        <div class="row"><div class="grow title">${esc(s.title)}</div>
          <select data-change="pickSession" class="no-print" aria-label="모임 선택">${options}</select></div>
        <div class="meta">${fmtDate(s.date)} · ${roundTime(s, 1).slice(0, 5)}~${roundTime(s, s.rounds).slice(6)} · 코트 ${s.courts}면 · ${s.rounds}라운드(${s.round_minutes}분)</div>
        <div class="meta">${GENDER_MODE[s.gender_mode]}${dlTxt ? ' · ' + dlTxt : ''}</div>
        <span class="status ${s.status === 'generated' ? 'gen' : s.status}">${statusTxt}</span>
      </div>`;

    if (s.status === 'open') html += viewRegisterForm(s, regs);
    html += viewRegList(s, regs);
    if (s.status !== 'open') html += viewBracket(s);
    if (s.status !== 'open') html += viewTodayStats(s);
    if (store.isAdmin) html += viewSessionAdmin(s, regs);
    return html;
  }

  function regOpen(s) {
    return s.status === 'open' && (!s.deadline || Date.now() < new Date(s.deadline).getTime());
  }

  function viewRegisterForm(s, regs) {
    if (!regOpen(s) && !store.isAdmin) return `<div class="card muted small">신청이 마감됐어요. 관리자가 곧 대진표를 생성합니다.</div>`;
    const taken = new Set(regs.map((r) => r.member_id));
    const mine = regs.filter((r) => r.user_id && r.user_id === store.userId);
    const opts = state.data.members.filter((m) => m.active && !taken.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    const rOpts = (sel) => Array.from({ length: s.rounds }, (_, i) => `<option value="${i + 1}" ${sel === i + 1 ? 'selected' : ''}>${i + 1}R (${roundTime(s, i + 1).slice(0, 5)})</option>`).join('');
    return `
      <div class="card no-print">
        <h2>참가 신청 ${!regOpen(s) ? '<span class="tag">마감 · 관리자 대리 신청</span>' : ''}</h2>
        ${mine.length ? `<div class="small" style="margin-bottom:10px">내가 신청한 사람: ${mine.map((r) => `<span class="chip mine">${esc(nameOf(r.member_id))} <button class="x" data-action="cancelReg" data-id="${r.id}" title="취소">✕</button></span>`).join(' ')}</div>` : ''}
        <form data-submit="register">
          <label class="f">이름</label>
          <select name="member" required>
            <option value="">선택하세요</option>${opts}
            <option value="__new">+ 명단에 없어요 (게스트)</option>
          </select>
          <div class="newbox" hidden style="margin-top:10px">
            <div class="grid3">
              <div><label class="f">이름</label><input type="text" name="newName" maxlength="12" /></div>
              <div><label class="f">성별</label><select name="newGender"><option value="M">남</option><option value="F">여</option></select></div>
              <div><label class="f">레벨</label><select name="newLevel">${[1, 2, 3, 4, 5].map((l) => `<option ${l === 2 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            </div>
          </div>
          <div class="grid2" style="margin-top:10px">
            <div><label class="f">참여 시작 (늦참)</label><select name="from">${rOpts(1)}</select></div>
            <div><label class="f">참여 종료 (조퇴)</label><select name="to">${rOpts(s.rounds)}</select></div>
          </div>
          <div class="spacer"></div>
          <button class="btn primary block">신청하기</button>
        </form>
      </div>`;
  }

  function viewRegList(s, regs) {
    const m = mmap();
    const nF = regs.filter((r) => m[r.member_id]?.gender === 'F').length;
    const canEdit = store.isAdmin || (s.status === 'open');
    const items = regs.map((r) => {
      const mem = m[r.member_id];
      if (!mem) return '';
      const late = r.from_round > 1 ? `<span class="tag">${r.from_round}R~</span>` : '';
      const early = r.to_round && r.to_round < s.rounds ? `<span class="tag">~${r.to_round}R</span>` : '';
      const mine = r.user_id && r.user_id === store.userId;
      const x = canEdit && (store.isAdmin || mine) && s.status === 'open'
        ? `<button class="x no-print" data-action="cancelReg" data-id="${r.id}" title="취소">✕</button>` : '';
      return `<span class="chip ${mine ? 'mine' : ''}">${memberLabel(mem)}${late}${early}${x}</span>`;
    }).join('');
    return `
      <div class="card">
        <h2>신청 현황 <span class="sub">${regs.length}명 (남 ${regs.length - nF} · 여 ${nF})</span></h2>
        ${regs.length ? `<div class="chips">${items}</div>` : '<div class="empty">아직 신청한 사람이 없어요 🎾</div>'}
        ${s.status === 'open' && regs.length > 0 && regs.length < 4 ? '<div class="small muted" style="margin-top:8px">최소 4명이 있어야 대진을 만들 수 있어요.</div>' : ''}
      </div>`;
  }

  function viewBracket(s) {
    const ms = matchesOf(s.id);
    if (!ms.length) return `<div class="card empty">대진표가 없어요.</div>`;
    const m = mmap();
    const regs = regsOf(s.id);
    const swap = store.isAdmin && state.swapMode && s.status === 'generated';
    const pl = (id, round, matchId, slot) => {
      const sel = state.swapSel && state.swapSel.round === round && state.swapSel.memberId === id;
      const g = m[id]?.gender === 'F' ? ' <span class="g-F">♀</span>' : '';
      return swap
        ? `<button class="pl swappable ${sel ? 'sel' : ''}" data-action="swapPick" data-round="${round}" data-mid="${matchId || ''}" data-slot="${slot || ''}" data-pid="${id}">${esc(nameOf(id))}${g}</button>`
        : `<span class="pl">${esc(nameOf(id))}${g}</span>`;
    };
    const pending = ms.filter((x) => !x.winner && x.reported_winner).length;
    let html = `<div class="card"><h2>대진표 <span class="sub">${ms.length}경기${pending ? ` · 승인대기 ${pending}` : ''}</span></h2>`;
    html += `<div class="row no-print" style="margin-bottom:12px">
      <button class="btn sm" data-action="copyText">📋 카톡용 복사</button>
      <button class="btn sm" data-action="print">🖨 출력</button>
      ${store.isAdmin && s.status === 'generated' ? `<button class="btn sm ${state.swapMode ? 'primary' : ''}" data-action="toggleSwap">${state.swapMode ? '교체 모드 끄기' : '↔ 선수 교체'}</button>` : ''}
    </div>`;
    if (swap) html += `<div class="small muted no-print" style="margin-bottom:10px">같은 라운드에서 두 선수를 차례로 누르면 자리가 바뀌어요 (휴식자 포함).</div>`;
    for (let r = 1; r <= s.rounds; r++) {
      const rm = ms.filter((x) => x.round === r);
      const playing = new Set(rm.flatMap((x) => [x.p1, x.p2, x.p3, x.p4]));
      const rest = regs.filter((g) => g.from_round <= r && r <= (g.to_round || s.rounds) && !playing.has(g.member_id)).map((g) => g.member_id);
      html += `<div class="round"><div class="round-h"><b>${r}R</b><span class="muted small">${roundTime(s, r)}</span></div>`;
      for (const x of rm) {
        const c1 = x.winner === 1 ? 'win' : x.winner === 2 ? 'lose' : '';
        const c2 = x.winner === 2 ? 'win' : x.winner === 1 ? 'lose' : '';
        let mid = '';
        if (x.winner) mid = `<span class="score">${esc(x.score || (x.winner === 1 ? '승 : 패' : '패 : 승'))}</span>`;
        else if (x.reported_winner) mid = `<span class="pending">승인대기<br/>${x.reported_winner === 1 ? '팀1' : '팀2'} 승 ${esc(x.reported_score || '')}</span>`;
        else mid = `<span class="muted small">vs</span>`;
        const btn = s.status === 'generated' && (!x.winner || store.isAdmin)
          ? `<button class="res-btn" data-action="result" data-id="${x.id}">${x.winner ? '수정' : '결과'}</button>` : '';
        html += `<div class="match">
          <div class="court">${String.fromCharCode(64 + x.court)}</div>
          <div class="team t1 ${c1}">${pl(x.p1, r, x.id, 'p1')}${pl(x.p2, r, x.id, 'p2')}</div>
          <div class="vs">${mid}${btn}</div>
          <div class="team t2 ${c2}">${pl(x.p3, r, x.id, 'p3')}${pl(x.p4, r, x.id, 'p4')}</div>
        </div>`;
      }
      if (rest.length) html += `<div class="rest">휴식: ${rest.map((id) => pl(id, r, null, null)).join(', ')}</div>`;
      html += `</div>`;
    }
    return html + `</div>`;
  }

  function viewTodayStats(s) {
    const regs = regsOf(s.id);
    const sc = Ranking.sessionScores(s, regs, matchesOf(s.id));
    const rows = Object.entries(sc).map(([id, v]) => ({ id, ...v, games: [...new Set(v.rounds)].length,
      pts: v.attend * 10 + v.wins * 30 + v.streak * 5 }))
      .sort((a, b) => b.pts - a.pts || b.wins - a.wins);
    if (!rows.length) return '';
    return `<div class="card"><h2>오늘 점수 <span class="sub">참석10 · 승30 · 3연속5</span></h2>
      <table class="rank"><thead><tr><th>이름</th><th></th><th></th><th>출전</th><th>승-패</th><th>점수</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><button class="nm" data-action="member" data-id="${r.id}">${esc(nameOf(r.id))}</button></td><td></td><td>${r.streak ? '<span class="tag">🔥3연속</span>' : ''}</td><td>${r.games}</td><td>${r.wins}-${r.losses}</td><td class="pts">${r.pts}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function viewSessionAdmin(s, regs) {
    const ms = matchesOf(s.id);
    const anyResult = ms.some((x) => x.winner);
    const pending = ms.filter((x) => !x.winner && x.reported_winner).length;
    const others = state.data.members.filter((m) => !regs.some((r) => r.member_id === m.id) && m.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return `<div class="card no-print"><h2>⚙️ 모임 관리</h2>
      <form data-submit="sessionOpts" class="grid3">
        <div><label class="f">코트 수</label><input type="number" name="courts" min="1" max="6" value="${s.courts}" ${s.status !== 'open' ? 'disabled' : ''}/></div>
        <div><label class="f">라운드 수</label><input type="number" name="rounds" min="1" max="12" value="${s.rounds}" ${s.status !== 'open' ? 'disabled' : ''}/></div>
        <div><label class="f">성별 구성</label><select name="gender_mode" ${s.status !== 'open' ? 'disabled' : ''}>${Object.entries(GENDER_MODE).map(([k, v]) => `<option value="${k}" ${k === s.gender_mode ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${s.status === 'open' ? '<div style="grid-column:1/-1"><button class="btn sm">설정 저장</button></div>' : ''}
      </form>
      <div class="spacer"></div>
      ${s.status === 'open' && others.length ? `<form data-submit="adminAddReg" class="row"><select name="member" class="grow">${others.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button class="btn sm">대리 신청</button></form><div class="spacer"></div>` : ''}
      <div class="row">
        ${s.status === 'open' ? `<button class="btn primary" data-action="generate" ${regs.length < 4 ? 'disabled' : ''}>🎲 대진 생성 (${regs.length}명)</button>` : ''}
        ${s.status === 'generated' && !anyResult ? `<button class="btn" data-action="regenerate">🎲 다시 생성</button>` : ''}
        ${s.status === 'generated' ? `<button class="btn" data-action="reopen">↩ 접수중으로</button>` : ''}
        ${pending ? `<button class="btn primary" data-action="approveAll">✓ 승인대기 ${pending}건 모두 승인</button>` : ''}
        ${s.status === 'generated' ? `<button class="btn" data-action="closeSession">🏁 모임 종료</button>` : ''}
        ${s.status === 'closed' ? `<button class="btn" data-action="unclose">결과 수정 열기</button>` : ''}
        <button class="btn danger" data-action="deleteSession">모임 삭제</button>
      </div></div>`;
  }

  // ── 랭킹 탭 ──
  function currentPeriod() {
    if (state.period) return state.period;
    const ym = todayStr().slice(0, 7);
    return { month: ym, quarter: Ranking.quarterOf(ym), year: ym.slice(0, 4), all: 'all' }[state.periodType];
  }
  function shiftPeriod(p, dir) {
    if (p === 'all') return p;
    if (dir < 0) return Ranking.prevPeriod(p);
    // 다음 기간
    if (/^\d{4}-\d{2}$/.test(p)) { let [y, m] = p.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; }
    if (/^\d{4}-Q\d$/.test(p)) { let y = +p.slice(0, 4), q = +p.slice(6) + 1; if (q > 4) { q = 1; y++; } return `${y}-Q${q}`; }
    return String(+p + 1);
  }
  const periodLabel = (p) => p === 'all' ? '전체 누적'
    : /Q/.test(p) ? `${p.slice(0, 4)}년 ${p.slice(6)}분기`
    : p.length === 4 ? `${p}년` : `${p.slice(0, 4)}년 ${+p.slice(5)}월`;

  function viewRanking() {
    const p = currentPeriod();
    const { list, awards } = Ranking.withDelta(state.data, p);
    const has = (k, id) => (awards[k] || []).includes(id);
    const deltaTxt = (r) => r.delta == null ? (p === 'all' ? '' : '<span class="new">NEW</span>')
      : r.delta > 0 ? `<span class="up">▲${r.delta}</span>` : r.delta < 0 ? `<span class="down">▼${-r.delta}</span>` : '<span class="same">-</span>';
    const rows = list.map((r) => `<tr>
        <td><span class="rk ${r.rank <= 3 ? 'r' + r.rank : ''}">${r.rank}</span></td>
        <td>${deltaTxt(r)}</td>
        <td><button class="nm" data-action="member" data-id="${r.id}">${esc(r.name)}</button>
          <span class="award">${has('riser', r.id) ? ' 🚀' : ''}${has('attend', r.id) ? ' 🔥' : ''}</span></td>
        <td class="pts">${r.points}</td>
        <td>${r.attend}</td>
        <td>${r.wins}-${r.losses}</td>
        <td class="hide-sm">${r.winRate == null ? '-' : Math.round(r.winRate * 100) + '%'}</td>
        <td class="hide-sm muted">${r.adj ? (r.adj > 0 ? '+' : '') + r.adj : ''}</td>
      </tr>`).join('');
    const seg = [['month', '월간'], ['quarter', '분기'], ['year', '연간'], ['all', '전체']]
      .map(([k, v]) => `<button class="${state.periodType === k ? 'on' : ''}" data-action="ptype" data-v="${k}">${v}</button>`).join('');
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div class="seg">${seg}</div>
          ${p !== 'all' ? `<div class="row"><button class="btn sm" data-action="pshift" data-v="-1">◀</button><b>${periodLabel(p)}</b><button class="btn sm" data-action="pshift" data-v="1">▶</button></div>` : '<b>전체 누적</b>'}
        </div>
      </div>
      <div class="card">
        ${list.length ? `
        <div class="small muted" style="margin-bottom:8px">🚀 도약상(순위 최대 상승) · 🔥 출석상(최다 참석)</div>
        <table class="rank"><thead><tr><th>순위</th><th></th><th>이름</th><th>점수</th><th>참석</th><th>승-패</th><th class="hide-sm">승률</th><th class="hide-sm">보정</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="row" style="margin-top:12px"><button class="btn sm" data-action="csv">⬇ CSV 저장</button></div>` : '<div class="empty">이 기간에는 기록이 없어요.</div>'}
      </div>
      <div class="card rules">
        <b>점수 규칙</b> · 참석 +10 · 승리 +30 · 패배 0 · 한 모임 3경기 연속 출전 +5<br/>
        동점이면 승수 → 참석 수 순. 결과는 선수가 입력하고 관리자가 승인하면 반영됩니다.<br/>
        분기 랭킹 = 해당 3개월 합산, 등락은 직전 기간 대비.
      </div>`;
  }

  // ── 기록 탭 ──
  function viewHistory() {
    const ss = state.data.sessions.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!ss.length) return '<div class="card empty">기록이 없어요.</div>';
    return `<div class="card"><h2>지난 모임</h2>${ss.map((s) => {
      const n = regsOf(s.id).length, ms = matchesOf(s.id), done = ms.filter((x) => x.winner).length;
      const st = { open: '접수중', generated: '진행중', closed: '종료' }[s.status];
      return `<div class="list-item"><div class="grow"><b>${fmtDate(s.date)}</b> ${esc(s.title)}<div class="small muted">${n}명 · ${ms.length}경기 · 결과 ${done}/${ms.length}</div></div>
        <span class="tag">${st}</span><button class="btn sm" data-action="openSession" data-id="${s.id}">보기</button></div>`;
    }).join('')}</div>`;
  }

  // ── 관리 탭 ──
  function viewAdmin() {
    if (!store.isAdmin) {
      if (store.mode === 'demo') {
        return `<div class="card"><h2>관리자 모드</h2><p class="small muted">데모 모드에서는 비밀번호 없이 관리자 기능을 써볼 수 있어요.</p>
          <button class="btn primary" data-action="demoAdmin">관리자 모드 켜기</button></div>`;
      }
      return `<div class="card"><h2>관리자 로그인</h2>
        <form data-submit="login">
          <label class="f">이메일</label><input type="email" name="email" required autocomplete="username" />
          <div class="spacer"></div>
          <label class="f">비밀번호</label><input type="password" name="password" required autocomplete="current-password" />
          <div class="spacer"></div><button class="btn primary block">로그인</button>
        </form></div>`;
    }
    const sat = (() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const members = state.data.members.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'ko'));
    const pend = state.data.matches.filter((x) => !x.winner && x.reported_winner);
    const adj = state.data.adjustments.slice().sort((a, b) => b.month.localeCompare(a.month));
    return `
      <div class="card"><h2>새 모임 만들기</h2>
        <form data-submit="createSession">
          <div class="grid2">
            <div><label class="f">제목</label><input type="text" name="title" value="정기 모임" maxlength="30" /></div>
            <div><label class="f">날짜</label><input type="date" name="date" value="${sat}" required /></div>
          </div><div class="spacer"></div>
          <div class="grid3">
            <div><label class="f">시작</label><input type="time" name="start" value="17:00" /></div>
            <div><label class="f">라운드(분)</label><input type="number" name="minutes" value="30" min="10" max="120" /></div>
            <div><label class="f">신청 마감(당일)</label><input type="time" name="deadline" value="16:00" /></div>
            <div><label class="f">코트 수</label><input type="number" name="courts" value="2" min="1" max="6" /></div>
            <div><label class="f">라운드 수</label><input type="number" name="rounds" value="6" min="1" max="12" /></div>
            <div><label class="f">성별 구성</label><select name="gender_mode">${Object.entries(GENDER_MODE).map(([k, v]) => `<option value="${k}" ${k === 'balance' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          </div><div class="spacer"></div>
          <button class="btn primary block">모임 열기</button>
        </form></div>

      ${pend.length ? `<div class="card"><h2>승인 대기 결과 <span class="sub">${pend.length}건</span></h2>${pend.map((x) => {
        const s = sessionById(x.session_id);
        return `<div class="list-item"><div class="grow small"><b>${s ? s.date : ''} ${x.round}R ${String.fromCharCode(64 + x.court)}코트</b><br/>
          ${esc(nameOf(x.p1))}·${esc(nameOf(x.p2))} vs ${esc(nameOf(x.p3))}·${esc(nameOf(x.p4))}<br/>
          <span class="pending">팀${x.reported_winner} 승 ${esc(x.reported_score || '')} · 입력 ${esc(x.reported_by || '')}</span></div>
          <button class="btn sm primary" data-action="approve" data-id="${x.id}">승인</button>
          <button class="btn sm" data-action="reject" data-id="${x.id}">반려</button></div>`;
      }).join('')}</div>` : ''}

      <div class="card"><h2>회원 관리 <span class="sub">${members.filter((m) => m.active).length}명 활동</span></h2>
        <form data-submit="addMember" class="row" style="margin-bottom:10px">
          <input type="text" name="name" placeholder="이름" maxlength="12" required class="grow" style="width:auto" />
          <select name="gender" style="width:auto"><option value="M">남</option><option value="F">여</option></select>
          <select name="level" style="width:auto">${[1, 2, 3, 4, 5].map((l) => `<option value="${l}" ${l === 2 ? 'selected' : ''}>Lv${l}</option>`).join('')}</select>
          <button class="btn sm primary">추가</button>
        </form>
        ${members.map((m) => `<div class="list-item">
          <div class="grow"><b style="${m.active ? '' : 'opacity:.5'}">${esc(m.name)}</b>${m.is_guest ? ' <span class="tag">게스트</span>' : ''}</div>
          <select data-change="memberGender" data-id="${m.id}" style="width:auto">${['M', 'F'].map((g) => `<option value="${g}" ${m.gender === g ? 'selected' : ''}>${g === 'M' ? '남' : '여'}</option>`).join('')}</select>
          <select data-change="memberLevel" data-id="${m.id}" style="width:auto">${[1, 2, 3, 4, 5].map((l) => `<option value="${l}" ${m.level === l ? 'selected' : ''}>Lv${l}</option>`).join('')}</select>
          <button class="btn sm" data-action="toggleActive" data-id="${m.id}">${m.active ? '휴면' : '복귀'}</button>
          ${m.is_guest ? `<button class="btn sm danger" data-action="delMember" data-id="${m.id}">삭제</button>` : ''}
        </div>`).join('')}
        <p class="small muted">레벨은 대진 실력 균형에 쓰여요 (1 입문 ~ 5 상급). 휴면 회원은 신청 목록에서 숨겨집니다.</p>
      </div>

      <div class="card"><h2>점수 보정</h2>
        <p class="small muted" style="margin-top:0">엑셀 이관 점수, 이벤트 가산, 벌점 등을 월 단위로 더하거나 뺍니다.</p>
        <form data-submit="addAdj" class="grid2">
          <div><label class="f">회원</label><select name="member">${state.data.members.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
          <div><label class="f">반영 월</label><input type="text" name="month" value="${todayStr().slice(0, 7)}" pattern="\\d{4}-\\d{2}" required /></div>
          <div><label class="f">점수 (±)</label><input type="number" name="points" required /></div>
          <div><label class="f">사유</label><input type="text" name="note" maxlength="30" /></div>
          <div style="grid-column:1/-1"><button class="btn sm primary">보정 추가</button></div>
        </form>
        ${adj.slice(0, 40).map((a) => `<div class="list-item small"><div class="grow"><b>${esc(nameOf(a.member_id))}</b> ${a.month} <b>${a.points > 0 ? '+' : ''}${a.points}</b> <span class="muted">${esc(a.note || '')}</span></div>
          <button class="btn sm danger" data-action="delAdj" data-id="${a.id}">삭제</button></div>`).join('')}
      </div>

      <div class="card"><div class="row">
        <button class="btn" data-action="logout">관리자 로그아웃</button>
        ${store.mode === 'demo' ? '<button class="btn danger" data-action="resetDemo">데모 데이터 초기화</button>' : ''}
      </div></div>`;
  }

  // ───────── 대진 생성 ─────────
  function buildPlayers(s) {
    const regs = regsOf(s.id);
    const m = mmap();
    const rk = Ranking.compute(state.data, Ranking.quarterOf(s.date.slice(0, 7)));
    const order = Object.fromEntries(rk.map((r, i) => [r.id, i]));
    const n = Math.max(1, rk.length - 1);
    return regs.filter((r) => m[r.member_id]).map((r) => {
      const mem = m[r.member_id];
      const bonus = order[r.member_id] != null ? 0.5 * (1 - order[r.member_id] / n) : 0.25;
      return {
        id: r.member_id, gender: mem.gender, strength: Number(mem.level) + bonus,
        from: Math.max(1, Math.min(s.rounds, r.from_round || 1)),
        to: Math.max(1, Math.min(s.rounds, r.to_round || s.rounds)),
      };
    });
  }

  async function generate(s) {
    const players = buildPlayers(s);
    if (players.length < 4) throw new Error('최소 4명이 필요해요');
    const since = new Date(s.date); since.setDate(since.getDate() - 90);
    const pastIds = new Set(state.data.sessions.filter((x) => x.id !== s.id && x.date < s.date && new Date(x.date) >= since).map((x) => x.id));
    const history = Scheduler.buildHistory(state.data.matches.filter((x) => pastIds.has(x.session_id)));
    const res = Scheduler.generate({ players, courts: s.courts, rounds: s.rounds, genderMode: s.gender_mode, history, attempts: 40 });
    const rows = res.rounds.flatMap((rd) => rd.matches.map((mt) => ({
      session_id: s.id, round: rd.round, court: mt.court, p1: mt.t1[0], p2: mt.t1[1], p3: mt.t2[0], p4: mt.t2[1],
    })));
    await store.removeWhere('matches', 'session_id', s.id);
    if (rows.length) await store.insert('matches', rows);
    await store.update('sessions', s.id, { status: 'generated' });
  }

  // ───────── 결과 입력 모달 ─────────
  function openResult(matchId) {
    const x = state.data.matches.find((m) => m.id === matchId);
    if (!x) return;
    const pick = x.winner || x.reported_winner || 0;
    const score = x.score || x.reported_score || '';
    openModal(`
      <h3>${x.round}R ${String.fromCharCode(64 + x.court)}코트 결과</h3>
      <form data-submit="saveResult" data-id="${x.id}">
        <div class="pick">
          <button type="button" class="t1 ${pick === 1 ? 'on' : ''}" data-action="pickWin" data-v="1">팀1 승<br/><span class="small">${esc(nameOf(x.p1))} · ${esc(nameOf(x.p2))}</span></button>
          <button type="button" class="t2 ${pick === 2 ? 'on' : ''}" data-action="pickWin" data-v="2">팀2 승<br/><span class="small">${esc(nameOf(x.p3))} · ${esc(nameOf(x.p4))}</span></button>
        </div>
        <input type="hidden" name="winner" value="${pick || ''}" />
        <div class="spacer"></div>
        <div class="grid2">
          <div><label class="f">스코어 (선택)</label><input type="text" name="score" value="${esc(score)}" placeholder="6:3" maxlength="12" /></div>
          ${store.isAdmin ? '' : `<div><label class="f">입력자</label><select name="reporter" required><option value="">선택</option>${[x.p1, x.p2, x.p3, x.p4].map((id) => `<option>${esc(nameOf(id))}</option>`).join('')}</select></div>`}
        </div>
        <p class="small muted">${store.isAdmin ? '관리자 입력은 바로 확정됩니다.' : '관리자가 승인하면 랭킹에 반영돼요.'}</p>
        <div class="row">
          <button class="btn primary grow">${store.isAdmin ? '확정' : '결과 보내기'}</button>
          ${store.isAdmin && (x.winner || x.reported_winner) ? '<button type="button" class="btn danger" data-action="clearResult" data-id="' + x.id + '">결과 지우기</button>' : ''}
          <button type="button" class="btn" data-action="closeModal">닫기</button>
        </div>
      </form>`);
  }

  // ───────── 선수 교체 ─────────
  async function swapPick(el) {
    const round = +el.dataset.round;
    const cur = { round, matchId: el.dataset.mid || null, slot: el.dataset.slot || null, memberId: el.dataset.pid };
    const a = state.swapSel;
    if (!a || a.round !== round) { state.swapSel = cur; render(); return; }
    if (a.memberId === cur.memberId) { state.swapSel = null; render(); return; }
    state.swapSel = null;
    if (!a.matchId && !cur.matchId) { toast('휴식자끼리는 바꿀 필요가 없어요'); render(); return; }
    const patches = {};
    const put = (sel, val) => { (patches[sel.matchId] = patches[sel.matchId] || {})[sel.slot] = val; };
    if (a.matchId) put(a, cur.memberId);
    if (cur.matchId) put(cur, a.memberId);
    for (const id in patches) {
      const mt = state.data.matches.find((m) => m.id === id);
      if (mt?.winner) { toast('결과가 확정된 경기는 바꿀 수 없어요'); render(); return; }
    }
    await act(async () => {
      for (const id in patches) await store.update('matches', id, patches[id]);
    }, `${nameOf(a.memberId)} ↔ ${nameOf(cur.memberId)}`);
  }

  // ───────── 텍스트/CSV ─────────
  function bracketText(s) {
    const ms = matchesOf(s.id);
    const regs = regsOf(s.id);
    let t = `🎾 ${s.title} ${fmtDate(s.date)}\n참석 ${regs.length}명\n`;
    for (let r = 1; r <= s.rounds; r++) {
      const rm = ms.filter((x) => x.round === r);
      const playing = new Set(rm.flatMap((x) => [x.p1, x.p2, x.p3, x.p4]));
      t += `\n[${r}R ${roundTime(s, r)}]\n`;
      for (const x of rm) t += `${String.fromCharCode(64 + x.court)}: ${nameOf(x.p1)}·${nameOf(x.p2)} vs ${nameOf(x.p3)}·${nameOf(x.p4)}${x.winner ? `  (팀${x.winner} 승${x.score ? ' ' + x.score : ''})` : ''}\n`;
      const rest = regs.filter((g) => g.from_round <= r && r <= (g.to_round || s.rounds) && !playing.has(g.member_id)).map((g) => nameOf(g.member_id));
      if (rest.length) t += `휴식: ${rest.join(', ')}\n`;
    }
    return t;
  }

  function downloadCSV() {
    const p = currentPeriod();
    const { list } = Ranking.withDelta(state.data, p);
    const head = ['순위', '이름', '점수', '참석', '승', '패', '연속보너스', '보정', '등락'];
    const lines = [head.join(',')].concat(list.map((r) => [r.rank, r.name, r.points, r.attend, r.wins, r.losses, r.streak, r.adj, r.delta ?? ''].join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `랭킹_${p}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openMember(id) {
    const m = mmap()[id];
    if (!m) return;
    const all = Ranking.compute(state.data, 'all').find((r) => r.id === id) || { points: 0, attend: 0, wins: 0, losses: 0 };
    const mine = state.data.matches.filter((x) => x.winner && [x.p1, x.p2, x.p3, x.p4].includes(id));
    const partners = {};
    for (const x of mine) {
      const inT1 = x.p1 === id || x.p2 === id;
      const pt = inT1 ? (x.p1 === id ? x.p2 : x.p1) : (x.p3 === id ? x.p4 : x.p3);
      const won = (inT1 && x.winner === 1) || (!inT1 && x.winner === 2);
      const o = (partners[pt] = partners[pt] || { g: 0, w: 0 });
      o.g++; if (won) o.w++;
    }
    const top = Object.entries(partners).sort((a, b) => b[1].g - a[1].g || b[1].w - a[1].w).slice(0, 5);
    const recent = mine.map((x) => ({ x, s: sessionById(x.session_id) })).filter((o) => o.s)
      .sort((a, b) => b.s.date.localeCompare(a.s.date) || b.x.round - a.x.round).slice(0, 8);
    openModal(`
      <h3>${memberLabel(m)}</h3>
      <div class="stat">
        <div><b>${all.points}</b><span>누적점수</span></div>
        <div><b>${all.attend}</b><span>참석</span></div>
        <div><b>${all.wins}-${all.losses}</b><span>승-패</span></div>
        <div><b>${all.wins + all.losses ? Math.round(all.wins / (all.wins + all.losses) * 100) + '%' : '-'}</b><span>승률</span></div>
      </div>
      ${top.length ? `<h4>자주 친 파트너</h4>${top.map(([pid, o]) => `<div class="list-item small"><div class="grow">${esc(nameOf(pid))}</div>${o.g}경기 ${o.w}승</div>`).join('')}` : ''}
      ${recent.length ? `<h4>최근 경기</h4>${recent.map(({ x, s }) => {
        const inT1 = x.p1 === id || x.p2 === id;
        const won = (inT1 && x.winner === 1) || (!inT1 && x.winner === 2);
        const pt = inT1 ? (x.p1 === id ? x.p2 : x.p1) : (x.p3 === id ? x.p4 : x.p3);
        const op = inT1 ? [x.p3, x.p4] : [x.p1, x.p2];
        return `<div class="list-item small"><span class="tag" style="${won ? 'background:var(--t1-bg);color:var(--brand-2)' : ''}">${won ? '승' : '패'}</span>
          <div class="grow">w/ ${esc(nameOf(pt))} vs ${esc(nameOf(op[0]))}·${esc(nameOf(op[1]))}</div><span class="muted">${s.date.slice(5)} ${x.round}R</span></div>`;
      }).join('')}` : '<p class="muted small">확정된 경기 기록이 아직 없어요.</p>'}
      <div class="spacer"></div><button class="btn block" data-action="closeModal">닫기</button>`);
  }

  // ───────── 이벤트 ─────────
  const actions = {
    refresh: () => reload(),
    closeModal: () => closeModal(),
    print: () => window.print(),
    demoAdmin: () => act(() => store.login(), '관리자 모드'),
    logout: () => act(() => store.logout(), '로그아웃'),
    resetDemo: () => confirm('데모 데이터를 처음 상태로 되돌릴까요?') && act(async () => store.resetDemo(), '초기화했어요'),
    openSession: (el) => { state.sessionId = el.dataset.id; state.tab = 'session'; render(); window.scrollTo(0, 0); },
    cancelReg: (el) => confirm('신청을 취소할까요?') && act(() => store.remove('registrations', el.dataset.id), '취소했어요'),
    generate: () => act(() => generate(sessionById(state.sessionId)), '대진표를 만들었어요'),
    regenerate: () => confirm('대진을 새로 만들까요? 수동 교체 내용은 사라져요.') && act(() => generate(sessionById(state.sessionId)), '다시 만들었어요'),
    reopen: () => {
      const s = sessionById(state.sessionId);
      const hasRes = matchesOf(s.id).some((x) => x.winner || x.reported_winner);
      if (!confirm(hasRes ? '입력된 결과까지 모두 지워집니다. 접수중으로 되돌릴까요?' : '대진표를 지우고 접수중으로 되돌릴까요?')) return;
      act(async () => { await store.removeWhere('matches', 'session_id', s.id); await store.update('sessions', s.id, { status: 'open' }); }, '접수중으로 변경');
    },
    closeSession: () => {
      const s = sessionById(state.sessionId);
      const left = matchesOf(s.id).filter((x) => !x.winner).length;
      if (!confirm(left ? `결과 미확정 ${left}경기가 있어요. 그래도 종료할까요?` : '모임을 종료할까요?')) return;
      act(() => store.update('sessions', s.id, { status: 'closed' }), '모임을 종료했어요');
    },
    unclose: () => act(() => store.update('sessions', state.sessionId, { status: 'generated' })),
    deleteSession: () => {
      const s = sessionById(state.sessionId);
      if (!confirm(`'${s.date} ${s.title}' 모임과 신청·경기 기록을 모두 삭제할까요?`)) return;
      act(async () => {
        await store.removeWhere('matches', 'session_id', s.id);
        await store.removeWhere('registrations', 'session_id', s.id);
        await store.remove('sessions', s.id);
        state.sessionId = null;
      }, '삭제했어요');
    },
    approveAll: () => act(async () => {
      for (const x of matchesOf(state.sessionId).filter((m) => !m.winner && m.reported_winner))
        await store.update('matches', x.id, { winner: x.reported_winner, score: x.reported_score || null });
    }, '모두 승인했어요'),
    approve: (el) => {
      const x = state.data.matches.find((m) => m.id === el.dataset.id);
      act(() => store.update('matches', x.id, { winner: x.reported_winner, score: x.reported_score || null }), '승인');
    },
    reject: (el) => act(() => store.update('matches', el.dataset.id, { reported_winner: null, reported_score: null, reported_by: null, reported_at: null }), '반려'),
    clearResult: (el) => { closeModal(); act(() => store.update('matches', el.dataset.id, { winner: null, score: null, reported_winner: null, reported_score: null, reported_by: null, reported_at: null }), '결과를 지웠어요'); },
    result: (el) => openResult(el.dataset.id),
    pickWin: (el) => {
      const f = el.closest('form');
      f.winner.value = el.dataset.v;
      f.querySelectorAll('.pick button').forEach((b) => b.classList.toggle('on', b === el));
    },
    toggleSwap: () => { state.swapMode = !state.swapMode; state.swapSel = null; render(); },
    swapPick: (el) => swapPick(el),
    copyText: async () => {
      const t = bracketText(sessionById(state.sessionId));
      try { await navigator.clipboard.writeText(t); toast('복사했어요. 단톡방에 붙여넣기 하세요'); }
      catch (e) { openModal(`<h3>대진표 텍스트</h3><textarea style="width:100%;height:50vh">${esc(t)}</textarea><button class="btn block" data-action="closeModal">닫기</button>`); }
    },
    ptype: (el) => { state.periodType = el.dataset.v; state.period = null; render(); },
    pshift: (el) => { state.period = shiftPeriod(currentPeriod(), +el.dataset.v); render(); },
    csv: () => downloadCSV(),
    member: (el) => openMember(el.dataset.id),
    toggleActive: (el) => { const m = mmap()[el.dataset.id]; act(() => store.update('members', m.id, { active: !m.active })); },
    delMember: (el) => {
      const m = mmap()[el.dataset.id];
      if (state.data.matches.some((x) => [x.p1, x.p2, x.p3, x.p4].includes(m.id))) { toast('경기 기록이 있는 회원은 삭제 대신 휴면 처리하세요'); return; }
      if (confirm(`게스트 '${m.name}'을(를) 삭제할까요?`)) act(() => store.remove('members', m.id), '삭제했어요');
    },
    delAdj: (el) => confirm('이 보정을 삭제할까요?') && act(() => store.remove('adjustments', el.dataset.id), '삭제했어요'),
  };

  const submits = {
    async register(f) {
      const s = sessionById(state.sessionId);
      let memberId = f.member.value;
      const from = +f.from.value, to = +f.to.value;
      if (from > to) throw new Error('시작 라운드가 종료보다 늦어요');
      if (memberId === '__new') {
        const name = f.newName.value.trim();
        if (!name) throw new Error('이름을 입력하세요');
        const exist = state.data.members.find((m) => m.name === name);
        if (exist) memberId = exist.id;
        else {
          const [row] = await store.insert('members', { name, gender: f.newGender.value, level: +f.newLevel.value, is_guest: true, active: true });
          memberId = row.id;
        }
      }
      if (!memberId) throw new Error('이름을 선택하세요');
      await store.insert('registrations', { session_id: s.id, member_id: memberId, from_round: from, to_round: to === s.rounds ? null : to });
      return `${nameOf(memberId) === '?' ? '' : nameOf(memberId) + ' '}신청 완료!`;
    },
    async adminAddReg(f) {
      await store.insert('registrations', { session_id: state.sessionId, member_id: f.member.value, from_round: 1, to_round: null, user_id: null });
      return '대리 신청 완료';
    },
    async sessionOpts(f) {
      await store.update('sessions', state.sessionId, { courts: +f.courts.value, rounds: +f.rounds.value, gender_mode: f.gender_mode.value });
      return '저장했어요';
    },
    async createSession(f) {
      const date = f.date.value;
      const [row] = await store.insert('sessions', {
        title: f.title.value.trim() || '정기 모임', date, start_time: f.start.value || '17:00',
        courts: +f.courts.value, rounds: +f.rounds.value, round_minutes: +f.minutes.value,
        deadline: f.deadline.value ? `${date}T${f.deadline.value}:00+09:00` : null,
        gender_mode: f.gender_mode.value, status: 'open',
      });
      state.sessionId = row.id; state.tab = 'session';
      return '모임을 열었어요. 링크를 단톡방에 공유하세요';
    },
    async saveResult(f) {
      const id = f.dataset.id;
      const w = +f.winner.value;
      if (w !== 1 && w !== 2) throw new Error('이긴 팀을 선택하세요');
      const score = f.score.value.trim();
      if (store.isAdmin) await store.update('matches', id, { winner: w, score: score || null, reported_winner: w, reported_score: score || null });
      else await store.reportResult(id, w, score, f.reporter.value);
      closeModal();
      return store.isAdmin ? '확정했어요' : '보냈어요. 관리자 승인 후 반영됩니다';
    },
    async login(f) { await store.login(f.email.value, f.password.value); return '관리자 로그인'; },
    async addMember(f) {
      await store.insert('members', { name: f.name.value.trim(), gender: f.gender.value, level: +f.level.value, active: true, is_guest: false });
      return '추가했어요';
    },
    async addAdj(f) {
      await store.insert('adjustments', { member_id: f.member.value, month: f.month.value, points: +f.points.value, note: f.note.value.trim() || null });
      return '보정 추가';
    },
  };

  const changes = {
    pickSession: (el) => { state.sessionId = el.value; state.swapMode = false; render(); },
    memberGender: (el) => act(() => store.update('members', el.dataset.id, { gender: el.value })),
    memberLevel: (el) => act(() => store.update('members', el.dataset.id, { level: +el.value })),
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; state.swapMode = false; render(); window.scrollTo(0, 0); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { state.tab = go.dataset.goto; render(); return; }
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action]) { e.preventDefault(); actions[a.dataset.action](a); return; }
    if (e.target.id === 'modal') closeModal();
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-submit]');
    if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    let msg;
    try { msg = await submits[f.dataset.submit](f); }
    catch (err) { toast(err.message || String(err)); if (btn) btn.disabled = false; return; }
    if (msg) toast(msg);
    await reload();
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'member' && el.closest('form[data-submit="register"]')) {
      el.closest('form').querySelector('.newbox').hidden = el.value !== '__new';
    }
    if (el.dataset.change && changes[el.dataset.change]) changes[el.dataset.change](el);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(); });

  (async function init() {
    try { await store.init(); } catch (e) { toast('연결 실패: ' + e.message); }
    store.subscribe(reload);
    await reload();
  })();
})();
