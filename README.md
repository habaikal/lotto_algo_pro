# LOTTO QUANTUM ULTRA

Sci-Fi 글래스모피즘 + 수축 마르코프(EB-Markov) 로또 분석/예측 정적 웹앱.

## 실행 (빌드 불필요 — 최고 가성비/확장성)

```powershell
cd C:\app\lotto_algo_pro
npx serve .   # 또는: python -m http.server 8000
# → http://localhost:3000 (serve) / http://localhost:8000
```

`file://` 직접 열기에서는 CSV fetch가 차단되므로 반드시 로컬 서버로 실행.
배포: `index.html·styles.css·app.js·lotto_results.csv·manifest.json` 5개 파일을
Netlify / Vercel / GitHub Pages / Cloudflare Pages에 드래그-드롭하면 즉시 운영됨 (서버비 0원).

## 엔진 (app.js, lotto_markov_predictor.py와 동일 파라미터)

`score = log base + 0.6·ΣPMI(직전6) + 0.3·PMI(보너스)`, α=10/20/10 수축,
`softmax(score/1.5)` → 균형 거부표집(합98–177·홀2–4·저구간2–4) + 희귀패턴 제거(연속4+·직전중복4+)
→ 교집합≤3 분산. 대량 생성 최적화: 누적가중치+이진탐색, 청크 비동기(프로그레스),
n>200 시 윈도우 분산검사로 O(n²) 회피. 실측: 10,000게임 0.36초·불량 0건.
플랜 상한: FREE 5 · PRO 500 · ULTRA 10,000. 21게임 이상은 페이지 테이블(50/페이지),
CSV(엑셀 BOM)/TXT 일괄저장·전체복사·SNS 전송(X·텔레그램·페북·시스템공유) 지원.

## 보안 (서버 없음 — 공격 표면 최소화 설계)

- CSP 메타(`script-src 'self'` 등), 인라인 핸들러 제거, `noopener` 외부공유, 입력 정규화(숫자·범위 클램프), DOM 출력 이스케이프
- 개인정보 수집 없음(쿠키·추적·회원가입 없음, 저장/공유물은 순수 번호만)
- 핵심 알고리즘 보호: 클라이언트 난독화는 우회 가능하므로, `REMOTE_API` 후크 내장 —
  실서비스에서 스코어 API를 두면 가중치가 서버에 머물러 진짜로 보호됨 (미설정 시 로컬 폴백)

## 정직 고지

로또는 독립시행. 백테스트 Top6 0.82개 ≈ 무작위 0.80개(SE≈0.033, n.s.).
어떤 조합의 기대값도 동일 — 본 플랫폼의 가치는 검증 가능한 스코어링·재현성·UX.

## 데이터 갱신

매주 토요일 추첨 후 `lotto_results.csv`에 한 줄 추가 (또는 동행 크롤러로 교체).
