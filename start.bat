@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install the current LTS version from https://nodejs.org/ and run start.bat again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found with Node.js. Reinstall the current Node.js LTS version and run start.bat again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call :free_port 4317
if errorlevel 1 goto :startupFailed
call :free_port 5173
if errorlevel 1 goto :startupFailed

echo Starting the local project. Close this window to stop the server.
call npm run dev
set "exitCode=%errorlevel%"
echo Server stopped.
pause
exit /b %exitCode%

:startupFailed
echo Could not free the local application ports.
pause
exit /b 1

:free_port
set "PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo Stopping old local process on port %PORT%: %%P
  taskkill /PID %%P /T >nul 2>&1
)

for /L %%I in (1,1,5) do (
  call :port_is_free %PORT%
  if not errorlevel 1 exit /b 0
  timeout /t 1 /nobreak >nul
)

for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo Force stopping old local process on port %PORT%: %%P
  taskkill /F /PID %%P /T >nul 2>&1
)

for /L %%I in (1,1,5) do (
  call :port_is_free %PORT%
  if not errorlevel 1 exit /b 0
  timeout /t 1 /nobreak >nul
)

echo Port %PORT% is still in use. Close the process manually and try again.
exit /b 1

:port_is_free
netstat -ano -p tcp | findstr /r /c:":%~1 .*LISTENING" >nul
if errorlevel 1 exit /b 0
exit /b 1
