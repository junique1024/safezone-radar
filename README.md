# 세이프존 레이더 (SafeZone Radar) — Vercel 배포판 v2

"날씨 말고, 좌석의 체감을 잰다." 경기장 구역별 체감온도(WBGT) 관제 시연용 MVP.
2026 경기스포츠산업 공모전(안전·시설 관리 기술) 출품용.

## 구성
```
public/            정적 페이지 (Vercel outputDirectory)
  index.html       진입점 — 운영자 화면 / 관중 화면(#fan-구역ID)
  app.js           앱 로직
  styles.css       스타일(라이트·다크)
  qrcode.min.js    QRCode.js 1.0.0 (MIT)
  sw.js            오프라인 동작용 서비스 워커
  sample-kma-asos.csv  기상청 ASOS CSV 형식 예시(가상값)
api/state.js       방(room) 단위 상태 중계 API (Vercel Function)
vercel.json        배포 설정
dev-server.mjs     로컬 확인용 서버 (npm run dev → http://localhost:3000)
```

## Vercel 배포 (둘 중 하나)

**A. GitHub 연결 (권장)**
1. 이 폴더를 GitHub 저장소에 올린다.
2. vercel.com → Add New… → Project → 저장소 Import.
3. Framework Preset은 **Other** 그대로, 다른 설정 없이 Deploy.

**B. Vercel CLI**
```
npm i -g vercel
cd safezone-radar
vercel          # 처음: 로그인·프로젝트 생성
vercel --prod   # 운영 주소로 배포
```

## 실시간 연결을 안정적으로 (선택, 강력 권장)
기본값은 서버 함수 메모리에 상태를 임시 저장한다(화면에 "실시간 연결(간이)").
대부분 동작하지만 함수 인스턴스가 바뀌면 끊길 수 있다. 심사 당일에는 Redis를 붙인다.

1. Vercel 프로젝트 → **Storage** → Marketplace → **Upstash (Redis)** → Create (무료 플랜) → 이 프로젝트에 Connect
2. 환경변수(`KV_REST_API_URL`/`KV_REST_API_TOKEN` 또는 `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`)가 자동 추가됨
3. **Redeploy** → 화면 상단이 "실시간 연결"로 바뀌면 완료

## 2차 발표 데모 순서
1. 노트북에서 배포 주소 열기 → 상단 `방 XXXX` 코드 자동 생성
2. 관중 알림 연결 → QR 구역 선택 → **발표용 크게 보기** → 심사위원이 휴대폰으로 스캔
3. 시연 가열 구역·추가 열 슬라이더로 구역 온도 올리기 → 권고 카드 → **승인하고 관중 알림 발송**
4. 심사위원 휴대폰: 2초 안에 알림 + 진동(안드로이드) + 알림음
5. 응급 상황 발생 → AED 안내, 해당 구역 관중 화면에 "의료진 출동 중" 표시
6. 기상청 재현 탭 → 8/4 인천 ASOS 시간자료 CSV 업로드 → "지역 특보 판정 vs 경기장 구역" 비교 띠
7. 리허설 후 **시연 초기화**

## 현장 실측 모드 (10/27 3일 실측용)
- 측정 높이·날씨·메모 입력 → 구역 표에 측정기 값 입력 → 실제 날짜·시각과 함께 자동 기록
- 기록은 그 브라우저에 보관되므로 측정 끝날 때마다 **실측 기록 CSV 저장**

## 알려진 한계
- 방 코드를 아는 사람은 누구나 관중 화면을 볼 수 있다(인증 없음, 시연용).
- 관중 화면은 2초 간격 폴링. 아이폰 사파리는 진동 API를 지원하지 않아 소리·화면 강조만 된다.
- 지역 판정은 기상청 체감온도 33·35℃를 시각별로 단순 적용한 비교이며 실제 특보 발령 요건과 다르다.
- 간이 WBGT(호주 기상청 근사식)는 일사·바람을 평균 조건으로 가정한 추정이다.
