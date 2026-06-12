---
name: adr
description: Create the next numbered Architecture Decision Record in docs/ADR.md from the standard template. Use when a non-trivial architectural/technical decision is made and should be recorded.
---

# /adr — 다음 ADR 추가

목적: `docs/ADR.md` 에 결정을 표준 형식으로 기록한다.

## 절차
1. `docs/ADR.md` 를 읽어 **가장 큰 ADR 번호**를 찾고 +1 한다(4자리, 예: `ADR-0015`).
2. 사용자에게(또는 인자에서) **제목**과 **결정 요지**를 확인한다. 부족하면 간단히 질문.
3. 아래 템플릿으로 새 ADR 을 파일 끝에 추가한다(상태 기본 `Accepted`):

```markdown
## ADR-XXXX — <제목>
**상태**: Accepted
**맥락**: <왜 이 결정이 필요한가 — 문제/제약>
**결정**: <무엇을 하기로 했는가 — 구체적으로>
**대안**: <고려한 다른 선택지와 탈락 이유>
**결과**: <장점·트레이드오프·후속 영향>
```

4. 기존 결정을 뒤집는 경우, 해당 ADR 의 **상태를 `Superseded by ADR-XXXX`** 로 바꾸고 상호 링크.
5. 관련 문서(`ARCHITECTURE.md`/`CLAUDE.md`)와 모순되면 함께 갱신.

## 가드레일
- ADR 은 **간결**하게(맥락→결정→대안→결과). 구현 세부는 ARCHITECTURE 로.
- 커밋 메시지는 `docs(adr): add ADR-XXXX <제목>` (Conventional Commits).
