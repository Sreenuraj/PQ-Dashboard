@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: PQ Dashboard — Windows Start Script
:: Launches the backend server, Vite frontend, and opens the dashboard in your default browser.

set "DIR=%~dp0"
cd /d "%DIR%"

echo.
echo   ⬡  PQ Dashboard (Windows)
echo   ─────────────────────────────────

:: 1. Check Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   ❌ Node.js is not found in your PATH.
    echo   Please install Node.js (v18 or newer) from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Check npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   ❌ npm is not found in your PATH.
    echo   Please reinstall Node.js with npm included.
    echo.
    pause
    exit /b 1
)

set "PORT=3456"
set "FRONTEND_PORT=5173"
set "DB_PATH=%DIR%data\dashboard.db"

:: 3. Auto-install dependencies if node_modules is missing
if not exist "%DIR%node_modules\" (
    echo   📦 Installing npm dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo   ❌ npm install failed. Please check your internet connection.
        pause
        exit /b 1
    )
)

:: 4. Auto-detect Windows IDE task directories and configure pq-config.yaml
echo   ⚙️  Scanning IDE task locations for Windows...
node "%DIR%scripts\init-platform-config.js"

:: 5. Terminate any previous instances running on dashboard ports
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%FRONTEND_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)

:: 6. Check for first run
set "FIRST_RUN=false"
if not exist "%DB_PATH%" (
    set "FIRST_RUN=true"
    echo   📦 First run detected — will auto-scan all tasks from pq-config.yaml
)

:: 7. Start backend server in background
echo   🚀 Starting backend server (port %PORT%)...
start /B "PQ-Backend" node "%DIR%server\index.js" >nul 2>&1

:: 8. Wait for backend to be ready (up to 30 seconds)
echo   ⏳ Waiting for server to be ready...
set "SERVER_READY=false"
for /L %%i in (1,1,30) do (
    if "!SERVER_READY!"=="false" (
        node -e "const http=require('http'); http.get('http://127.0.0.1:%PORT%/api/analytics/overview', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1));" >nul 2>nul
        if !ERRORLEVEL! equ 0 (
            set "SERVER_READY=true"
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)

:: 9. On first run, trigger a full initial parse
if "%FIRST_RUN%"=="true" (
    echo   🔍 Scanning tasks from pq-config.yaml...
    node -e "const http=require('http'); const req=http.request('http://127.0.0.1:%PORT%/api/refresh', {method:'POST'}); req.on('error',()=>{}); req.end();" >nul 2>nul

    :: Poll until parsing completes (up to 120s)
    for /L %%i in (1,1,120) do (
        node -e "const http=require('http'); http.get('http://127.0.0.1:%PORT%/api/refresh/status', r=>{ let b=''; r.on('data',d=>b+=d); r.on('end',()=>{ process.exit(b.includes('\"parsing\":false')?0:1); }); }).on('error',()=>process.exit(1));" >nul 2>nul
        if !ERRORLEVEL! equ 0 (
            goto :parse_done
        )
        timeout /t 1 /nobreak >nul
    )
    :parse_done
    echo   ✅ Initial parse complete
)

:: 10. Start Vite frontend
echo   🎨 Starting frontend (port %FRONTEND_PORT%)...
start /B "PQ-Frontend" npm run dev >nul 2>&1

:: 11. Wait for frontend then open browser
timeout /t 3 /nobreak >nul
echo   🌐 Opening dashboard in browser...
start http://localhost:%FRONTEND_PORT%

echo.
echo   ✅ PQ Dashboard running!
echo   ─────────────────────────────────
echo   Dashboard: http://localhost:%FRONTEND_PORT%
echo   API:       http://localhost:%PORT%
echo   Proxy:     http://localhost:3457  ← set as VS Code http.proxy
echo.

set "CA_CERT_PATH=%DIR%data\proxy-certs\certs\ca.pem"
if exist "%CA_CERT_PATH%" (
    echo   🔒 HTTPS/SSL Trust Instructions:
    echo      Since VS Code extensions ignore proxy SSL settings, trust the proxy CA cert globally:
    echo.
    echo      🔌 Windows (Run in Admin PowerShell):
    echo         Import-Certificate -FilePath "%CA_CERT_PATH%" -CertStoreLocation Cert:\LocalMachine\Root
    echo.
)

echo   Press any key or Ctrl+C to stop all servers...
pause >nul

echo.
echo   Stopping servers...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%FRONTEND_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
echo   ✓ Servers stopped.
