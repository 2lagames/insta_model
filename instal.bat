@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if exist ".git" (
  echo This folder already contains an application checkout. Run update.bat instead.
  pause
  exit /b 1
)

if exist "package.json" (
  echo This folder already contains an application checkout. Run update.bat instead.
  pause
  exit /b 1
)

where winget >nul 2>&1
if errorlevel 1 (
  echo Windows Package Manager ^(winget^) was not found. Install App Installer from Microsoft Store, then run instal.bat again.
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo Installing Git...
  winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo Git installation failed.
    pause
    exit /b 1
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo Installing Node.js LTS...
  winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo Node.js installation failed.
    pause
    exit /b 1
  )
)

call :refreshPath

where git >nul 2>&1
if errorlevel 1 (
  echo Git was not found after installation. Restart Command Prompt and run instal.bat again.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found after installation. Restart Command Prompt and run instal.bat again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found with Node.js. Restart Command Prompt and run instal.bat again.
  pause
  exit /b 1
)

echo Downloading the latest application release...
git init
if errorlevel 1 (
  echo Could not initialise the application folder as a Git repository.
  pause
  exit /b 1
)

git remote add origin https://github.com/2lagames/insta_model.git
if errorlevel 1 (
  echo Could not configure the application repository.
  pause
  exit /b 1
)

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

echo Installing application dependencies...
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

:refreshPath
set "SYSTEM_PATH="
set "USER_PATH="
for /f "tokens=2,*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul ^| findstr /i "Path"') do set "SYSTEM_PATH=%%b"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul ^| findstr /i "Path"') do set "USER_PATH=%%b"
set "PATH=%SYSTEM_PATH%;%USER_PATH%;%PATH%"
exit /b 0
