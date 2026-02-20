@echo off
setlocal
cd /d %~dp0
node tools\build_runtime.js
if %errorlevel% neq 0 (
  echo.
  echo Runtime build failed.
  pause
  exit /b %errorlevel%
)
echo.
echo Runtime build complete.
pause
