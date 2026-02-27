$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host 'Smoke: checking core files...'
$required = @(
  'index.html',
  'game_bundle.js',
  'data_bundle.js',
  'PLAY_WILDLANDS.html'
)

foreach($f in $required){
  if(-not (Test-Path $f)){ throw "Missing required file: $f" }
}

Write-Host 'Smoke: core files present.'
Write-Host 'Smoke: quick node syntax check (game.js)...'
node --check game.js | Out-Host
Write-Host 'Smoke: PASS'
