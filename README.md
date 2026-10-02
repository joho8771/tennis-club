# 🎾 테니스 복식 랭킹 & 대진표

엑셀 `Tennis_king_Rank_Scheduler_MK1` + 토요 테니스 클럽 신청 페이지를 합쳐 웹으로 옮긴 버전.
GitHub Pages(정적 호스팅) + Supabase(DB) 구성이라 서버 비용이 없습니다.

## 기능
| 구분 | 내용 |
|---|---|
| 신청 | 로그인 없이 이름 선택 → 신청/취소 (익명 세션으로 본인 신청만 취소 가능), 늦참·조퇴 라운드 지정, 게스트 등록 |
| 대진 | 관리자가 버튼 한 번으로 생성. 경기 수 균등 → 휴식 로테이션 → 실력 균형 → 파트너/상대 반복 최소화(최근 90일 이력 반영) → 성별 구성(무관/성비 맞춤/혼복 우선) |
| 설정 | 코트 1~6면, 라운드 1~12, 라운드당 분, 시작 시간, 신청 마감 |
| 수정 | 관리자 "선수 교체" 모드: 같은 라운드 두 선수 탭 → 자리 교체 (휴식자 포함) |
| 결과 | 선수가 입력 → 관리자 승인 시 랭킹 반영. 관리자 입력은 즉시 확정 |
| 랭킹 | 월간/분기/연간/전체, 전 기간 대비 등락, 🚀도약상·🔥출석상, 개인 전적·파트너 통계, CSV 저장 |
| 공유 | 카톡용 텍스트 복사, A4 가로 출력 |

점수 규칙(엑셀과 동일): 참석 +10 · 승리 +30 · 패배 0 · 한 모임 3경기 연속 출전 +5
동점: 승수 → 참석 수. 엑셀에 있던 누적 점수는 `점수 보정`으로 이관.

## 엑셀 대비 개선점
- 고정 패턴표(Sheet1, 8~16명) → 알고리즘 생성: 인원·코트·라운드 제약 없음, 과거 파트너 이력 반영
- `월간 총점` 수식 `#REF!` 깨짐 + 하드코딩 → DB 기반 자동 집계
- 월별 수동 입력 → 월/분기/연간 자동 집계 및 등락
- 결과 입력을 선수에게 분산 (관리자는 승인만)

## 로컬 실행 (데모 모드)
`js/config.js`가 비어 있으면 브라우저 저장소로 동작합니다. 관리 탭에서 비밀번호 없이 관리자 모드 사용 가능.
```bash
python -m http.server 5173
```
→ http://localhost:5173

알고리즘 테스트: `node test/scheduler.test.js`

## 배포 (약 15분)

### 1. Supabase
1. https://supabase.com 에서 새 프로젝트 생성 (Region: Northeast Asia (Seoul))
2. **SQL Editor** → `supabase/schema.sql` 전체 붙여넣고 Run
3. (선택) `supabase/seed.sql`에서 이관 월(`'2026-09'`)과 상진·주훈 성별/레벨 확인 후 Run
4. **Authentication → Sign In / Providers** → `Allow anonymous sign-ins` 켜기 (회원 신청용)
5. **Authentication → Users → Add user**로 관리자 계정(이메일/비밀번호) 생성 → SQL Editor에서:
   ```sql
   insert into admins (user_id) select id from auth.users where email = '관리자이메일';
   ```
6. **Project Settings → API**에서 `Project URL`, `anon public` 키 복사 → `js/config.js`에 입력

### 2. GitHub Pages
1. GitHub에 새 저장소(예: `tennis-club`) 만들고 이 폴더 내용 push
2. 저장소 **Settings → Pages → Branch: main / root** → 저장
3. `https://<아이디>.github.io/tennis-club/` 링크를 단톡방에 공유

> anon key는 공개돼도 되는 키입니다. 쓰기 권한은 `schema.sql`의 RLS 정책이 막습니다
> (회원: 본인 신청/취소·게스트 등록·결과 신고만, 나머지는 관리자만).

## 매주 운영
1. 관리 탭 → 새 모임 만들기 → 링크 공유
2. 회원 신청 (마감 시각 이후 신청 불가, 관리자는 대리 신청 가능)
3. 모임 탭 → 🎲 대진 생성 → 필요하면 선수 교체 → 카톡용 복사
4. 경기 후 선수들이 결과 입력 → 관리자 "모두 승인"
5. 🏁 모임 종료

## 파일 구조
```
index.html          화면 골격
css/style.css       스타일 (모바일 우선, 다크모드, 인쇄)
js/config.js        Supabase 연결 정보
js/scheduler.js     대진 알고리즘 (순수 함수)
js/ranking.js       점수/랭킹 계산 (순수 함수)
js/store.js         데이터 계층 (Supabase / 데모)
js/app.js           화면/이벤트
supabase/schema.sql 테이블 + RLS + 결과 신고 RPC
supabase/seed.sql   엑셀 회원/점수 이관
test/               알고리즘·랭킹 테스트
```

## 다음 후보
- 마감 시각 자동 대진 생성 (Supabase Edge Function + cron)
- 코트별 레벨 분리(상위 코트/하위 코트) 옵션
- 회원별 비밀 PIN으로 결과 입력자 검증
