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

git diff --quiet
if errorlevel 1 (
  echo Tracked local changes were found. Commit or discard them before running update.bat.
  pause
  exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
  echo Tracked local changes were found. Commit or discard them before running update.bat.
  pause
  exit /b 1
)

echo Downloading the latest application release...
git fetch --tags --force origin
if errorlevel 1 (
  echo Could not download application releases from GitHub.
  pause
  exit /b 1
)

set "RELEASE_TAG="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "git tag --list 'v*' --sort=-v:refname ^| Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } ^| Select-Object -First 1"`) do set "RELEASE_TAG=%%i"
if not defined RELEASE_TAG (
  echo No stable application release tag was found.
  pause
  exit /b 1
)

echo Installing application release %RELEASE_TAG%...
git checkout --detach "%RELEASE_TAG%"
if errorlevel 1 (
  echo Could not check out application release %RELEASE_TAG%.
  pause
  exit /b 1
)

echo Installing project dependencies...
call npm ci
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
