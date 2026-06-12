#!/usr/bin/env node
// PreToolUse(Bash) 가드 — 에이전트가 git 훅을 우회하거나 강제 푸시하는 것을 차단한다.
// 입력: stdin JSON { tool_name, tool_input: { command } }
// 차단: exit 2 (+ stderr 가 Claude 에게 전달됨). 통과: exit 0.
import { readFileSync } from 'node:fs';

let data = {};
try { data = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* noop */ }

const tool = data.tool_name || '';
const cmd = (data.tool_input && data.tool_input.command) || '';
if (tool !== 'Bash' || !cmd) process.exit(0);

const isGit = /(^|\s|&&|\||;)git(\s|$)/.test(cmd);

// 1) --no-verify : commit/push 훅(TDD·강제푸시 차단·lint/test)을 통째로 우회
if (/--no-verify/.test(cmd)) {
  process.stderr.write(
    "차단: '--no-verify' 는 git 훅(TDD 가드·강제푸시 차단·lint/build/test)을 우회합니다.\n" +
    "훅을 통과하도록 코드를 고치세요. 정말 필요하면 사용자가 직접 실행해야 합니다.\n"
  );
  process.exit(2);
}

// 2) 강제 푸시
if (isGit && /\bpush\b/.test(cmd) && /(--force(-with-lease)?\b|\s-f\b)/.test(cmd)) {
  process.stderr.write(
    "차단: 강제 푸시(--force/-f/--force-with-lease)는 금지입니다.\n" +
    "히스토리 재작성 대신 새 커밋이나 PR을 사용하세요.\n"
  );
  process.exit(2);
}

process.exit(0);
