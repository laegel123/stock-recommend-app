#!/usr/bin/env bash
# git 훅 활성화 (최초 1회). core.hooksPath 를 버전관리되는 .githooks 로 지정한다.
set -e
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "✓ git 훅 활성화됨 (core.hooksPath=.githooks). pre-push 에서 lint/build/test·강제푸시 차단이 강제됩니다."
