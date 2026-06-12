#!/usr/bin/env node
// PostToolUse(Edit|Write) — 편집된 코드 파일을 자동 포맷(+선택적 타입체크)한다.
// 베스트-에포트: 실패해도 절대 차단하지 않는다(항상 exit 0). package.json 전(스캐폴딩 전)엔 no-op.
// 입력: stdin JSON { tool_input: { file_path } }
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

function done() { process.exit(0); }

let data = {};
try { data = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { done(); }

const fp = (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';
if (!/\.(ts|tsx|js|jsx)$/.test(fp)) done();
if (!existsSync('package.json')) done();

const pm = existsSync('pnpm-lock.yaml') ? 'pnpm' : 'npm';
function hasScript(name) {
  try { const p = JSON.parse(readFileSync('package.json', 'utf8')); return !!(p.scripts && p.scripts[name]); }
  catch { return false; }
}

// 1) 변경 파일만 빠르게 포맷 (로컬 prettier 가 없으면 조용히 패스)
try { execSync(`npx --no-install prettier --write "${fp}"`, { stdio: 'ignore' }); } catch { /* noop */ }

// 2) 타입체크(스크립트가 있을 때만; 느릴 수 있으므로 베스트-에포트, 비차단)
//    너무 잦으면 .claude/settings.json 의 PostToolUse 에서 이 줄 호출만 제거하면 됨.
if (hasScript('typecheck')) {
  try { execSync(`${pm} run typecheck`, { stdio: 'ignore' }); } catch { /* 비차단 */ }
}

done();
