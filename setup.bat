@echo off
setlocal enabledelayedexpansion

title Upsell Bot - Setup
color 0A

:: ── Refresh PATH immediately so previously-installed tools are found ──────────
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USER_PATH=%%b"
set "PATH=!SYS_PATH!;!USER_PATH!;%APPDATA%\npm"

echo.
echo  ================================================
echo    Upsell Bot - One-Time Setup
echo  ================================================
echo.
echo  This will install everything needed to run the Sales Agent.
echo  Takes about 3-5 minutes on first run.
echo.
echo  Press any key to begin...
pause >nul

:: ── Step 1: Node.js ──────────────────────────────────────────────────────────
echo.
echo  [1/5]  Checking Node.js...

node --version >nul 2>&1
if !errorlevel! neq 0 goto :install_node

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
set "TEMP_VER=!NODE_VER:~1!"
for /f "tokens=1 delims=." %%m in ("!TEMP_VER!") do set "NODE_MAJOR=%%m"
if !NODE_MAJOR! lss 18 goto :install_node

echo         Node.js !NODE_VER! - OK
goto :check_claude

:install_node
echo         Node.js not found or too old. Installing...
echo.

winget --version >nul 2>&1
if !errorlevel! equ 0 (
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
    if !errorlevel! neq 0 goto :node_manual
) else goto :node_manual

:: Refresh PATH after Node install
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USER_PATH=%%b"
set "PATH=!SYS_PATH!;!USER_PATH!;%APPDATA%\npm"

node --version >nul 2>&1
if !errorlevel! neq 0 goto :node_manual

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo         Node.js !NODE_VER! installed - OK
goto :check_claude

:node_manual
echo.
echo  Could not install Node.js automatically.
echo.
echo  Please:
echo    1. Open this link in your browser:  https://nodejs.org/en/download
echo    2. Download and run the Windows Installer (.msi)
echo    3. Re-run this setup file when done.
echo.
pause
exit /b 1

:: ── Step 2: Claude Code CLI ──────────────────────────────────────────────────
:check_claude
echo.
echo  [2/5]  Checking Claude Code...

where claude >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('claude --version 2^>nul') do set "CLAUDE_VER=%%v"
    echo         Claude Code !CLAUDE_VER! - OK
    goto :login
)

echo         Installing Claude Code (this may take a minute)...
echo.
npm install -g @anthropic-ai/claude-code

:: Refresh PATH after install
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USER_PATH=%%b"
set "PATH=!PATH!;!USER_PATH!;%APPDATA%\npm"

:: Verify install succeeded
where claude >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo  ERROR: Claude Code install failed or not found in PATH.
    echo  Check your internet connection and try again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('claude --version 2^>nul') do set "CLAUDE_VER=%%v"
echo.
echo         Claude Code !CLAUDE_VER! installed - OK

:: ── Step 3: Claude Account Login ─────────────────────────────────────────────
:login
echo.
echo  [3/5]  Checking Claude account...

claude auth status >"%TEMP%\claude_auth.txt" 2>&1
findstr /i "logged in\|loggedIn.*true\|authenticated" "%TEMP%\claude_auth.txt" >nul 2>&1
if !errorlevel! equ 0 (
    echo         Already logged in - OK
    goto :clone_repo
)

echo.
echo         Not logged in. A browser window will open.
echo         Sign in with your Claude account.
echo         (Requires Claude Pro, Team, or Enterprise subscription.)
echo.
echo  Press any key when ready...
pause >nul
echo.

claude auth login

echo.
echo  Verifying login...
claude auth status >"%TEMP%\claude_auth.txt" 2>&1
findstr /i "logged in\|loggedIn.*true\|authenticated" "%TEMP%\claude_auth.txt" >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo  ERROR: Login did not complete.
    echo  Please re-run this setup and sign in when the browser opens.
    echo.
    pause
    exit /b 1
)
echo         Logged in - OK

:: ── Step 4: Download Sales Agent ─────────────────────────────────────────────
:clone_repo
echo.
echo  [4/5]  Downloading Sales Agent...

set "DEST=%USERPROFILE%\Desktop\Sales-Agent"

if exist "%DEST%\.claude" (
    echo         Already downloaded at %DEST% - OK
    goto :mcp
)

git --version >nul 2>&1
if !errorlevel! equ 0 (
    echo         Cloning repository...
    git clone https://github.com/Kilowott-labs/Sales-Agent "%DEST%"
    if !errorlevel! neq 0 (
        echo.
        echo  ERROR: Download failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
) else (
    echo         Downloading ZIP...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/Kilowott-labs/Sales-Agent/archive/refs/heads/main.zip' -OutFile '%TEMP%\sales-agent.zip' -UseBasicParsing"
    if !errorlevel! neq 0 (
        echo.
        echo  ERROR: Download failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
    echo         Extracting...
    powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\sales-agent.zip' -DestinationPath '%TEMP%\sales-agent-extract' -Force"
    powershell -NoProfile -Command "Move-Item -Path '%TEMP%\sales-agent-extract\Sales-Agent-main' -Destination '%DEST%' -Force"
    del "%TEMP%\sales-agent.zip" >nul 2>&1
    rmdir /s /q "%TEMP%\sales-agent-extract" >nul 2>&1
)

echo         Saved to %DEST% - OK

:: ── Step 5: Chrome DevTools MCP ──────────────────────────────────────────────
:mcp
echo.
echo  [5/5]  Setting up browser tools...

claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest 2>nul
:: Exit code 1 means "already exists" which is fine
echo         Browser tools configured - OK

:: ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo  ================================================
echo    Setup complete!
echo  ================================================
echo.
echo  Sales Agent is ready. Opening now...
echo.
echo  When Claude Code opens, type:
echo.
echo      /upsell https://client-website.com
echo.
echo  Press any key to launch...
pause >nul

cd /d "%DEST%"
claude .
