# .githooks

버전 관리되는 git 훅. `core.hooksPath` 로 활성화한다(`.git/hooks` 대신 이 폴더 사용).

## 활성화 (최초 1회, 클론 후)
git 훅은 보안상 클론 시 자동 적용되지 않으므로 한 번 실행해야 한다:

```bash
# macOS/Linux/Git Bash
bash scripts/setup-hooks.sh
```
```powershell
# Windows PowerShell
scripts/setup-hooks.ps1
```

> pnpm 스캐폴딩 후에는 `package.json` 의 `"prepare": "git config core.hooksPath .githooks"` 로
> `pnpm install` 시 자동 활성화하도록 연결한다.

## pre-push 가 하는 일
1. **`main`/`master` 보호** — 강제(force / non-fast-forward) 푸시와 브랜치 삭제 푸시를 차단한다.
2. **테스트 우선(TDD) 백스톱** — 푸시되는 커밋에서 **소스(`apps|packages|services` 하위 코드)가 바뀌면
   테스트(`*.test.*`, `*.spec.*`, `__tests__/`, `test_*.py` 등)도 바뀌어야** 한다. 소스만 바뀌고 테스트가
   없으면 푸시를 차단한다. (제외: `*.d.ts`, `*.config.*`, 마이그레이션/생성물 등)
3. **lint → build → test 강제** — `package.json` 에 해당 스크립트가 있으면 실행하고, 하나라도 실패하면
   푸시를 중단한다. 스크립트가 아직 없으면 우아하게 건너뛴다(스캐폴딩 전에도 안전).

## TDD 가드 예외 (정당한 경우만)
순수 리팩터·설정 변경 등 새 테스트가 불필요할 때:
```bash
git commit -m "refactor: ... [skip-tdd]"   # 커밋 메시지 마커
# 또는
SKIP_TDD=1 git push                         # 1회성 환경변수
```

## 비상 우회 (전체 훅)
```bash
git push --no-verify
```
> `--no-verify` 는 강제푸시 차단까지 모두 건너뛰므로 일상 사용 금지. TDD만 건너뛰려면 위의 `[skip-tdd]`/`SKIP_TDD` 를 쓸 것.
> 클라이언트 훅은 우회 가능하므로, 권위 있는 보호는 **GitHub 브랜치 보호 규칙**(서버사이드)으로 보완한다.
