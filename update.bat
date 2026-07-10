@echo off
setlocal
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git was not found. Install Git from https://git-scm.com/downloads and run update.bat again.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install the current LTS version from https://nodejs.org/ and run update.bat again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found with Node.js. Reinstall the current Node.js LTS version and run update.bat again.
  pause
  exit /b 1
)

echo Updating the project...
git pull --ff-only
if errorlevel 1 (
  echo Project update failed. Resolve any Git changes, then run update.bat again.
  pause
  exit /b 1
)

echo Installing project dependencies...
call npm install
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)

echo Starting the local project. Close this window to stop the server.
call npm run dev
set "exitCode=%errorlevel%"
echo Server stopped.
pause
exit /b %exitCode%
