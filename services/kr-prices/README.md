# services/kr-prices (Phase 2 — 스캐폴드만)

한국 EOD 가격 사이드카. **Python (FastAPI + pykrx)** 로 구현 예정이며, 내부 HTTP 경계로
Node 백엔드와 격리한다(ADR 참조). MVP(Phase 0/1)에는 **코드 없음 — 자리만 확보**한다.

## 향후 레이아웃 (Phase 2)

```
services/kr-prices/
├─ pyproject.toml          # 의존성/메타데이터 (현재: 플레이스홀더)
├─ src/
│  └─ kr_prices/           # FastAPI 앱 + pykrx 어댑터
└─ tests/
   └─ test_*.py            # pytest (TDD — 하네스가 .py 소스에 테스트 동반 강제)
```

> ⚠️ 이 디렉터리에 `.py` 소스를 추가하는 순간 `.githooks/pre-push` 의 TDD 백스톱이
> 대응 `test_*.py` / `*_test.py` 를 요구한다. Python 툴체인(pytest 등)과 함께 도입할 것.
