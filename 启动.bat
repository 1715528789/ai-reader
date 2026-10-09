@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   AI Read - AI Reader
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install Node.js 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo Checking whether the app is already running...
curl -s -o NUL --max-time 2 http://localhost:5173/ >nul 2>&1
if %errorlevel%==0 (
  echo Already running. Opening http://localhost:5173
  start "" http://localhost:5173
  exit /b 0
)

if not exist "node_modules" (
  echo First run: installing dependencies...
  echo This may take a few minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Please check the log above.
    pause
    exit /b 1
  )
)

echo Starting dev server...
start "" http://localhost:5173
call npm run dev
pause
