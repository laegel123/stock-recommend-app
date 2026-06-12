# git 훅 활성화 (최초 1회, Windows PowerShell). core.hooksPath 를 .githooks 로 지정한다.
$ErrorActionPreference = "Stop"
$root = (git rev-parse --show-toplevel)
Set-Location $root
git config core.hooksPath .githooks
Write-Host "git 훅 활성화됨 (core.hooksPath=.githooks). pre-push 에서 lint/build/test·강제푸시 차단이 강제됩니다."
