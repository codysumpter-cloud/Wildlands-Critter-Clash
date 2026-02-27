$ErrorActionPreference = 'Stop'

Write-Host 'Packaging baseline-compatible player bundle...'
npm.cmd run play:pack:zip | Out-Host
Write-Host 'Done. Output: out/play-no-python.zip'
