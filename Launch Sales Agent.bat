@echo off
setlocal EnableDelayedExpansion
title Kilowott Sales Agent

:: ============================================================
::  KILOWOTT SALES AGENT ? ONE-CLICK SETUP & LAUNCH
:: ============================================================

set LOGFILE=%~dp0launch-log.txt
(
echo ============================================
echo  LAUNCH LOG -- %DATE% %TIME%
echo ============================================
echo.
) > "%LOGFILE%"

echo.
echo  ============================================
echo    KILOWOTT SALES AGENT
echo  ============================================
echo.
echo  Log: %LOGFILE%
echo.

:: ?? STEP 1: Node.js ??????????????????????????????????????????
echo  [1/4] Checking Node.js...
echo [STEP 1] Checking Node.js... >> "%LOGFILE%"
node --version >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :install_node

node -e "process.exit(parseInt(process.version.slice(1))<18?1:0)" >nul 2>&1
if errorlevel 1 goto :upgrade_node
goto :node_ok

:install_node
echo  Node.js not found. Installing via winget...
echo [STEP 1] Installing Node.js via winget... >> "%LOGFILE%"
winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements >> "%LOGFILE%" 2>&1
if errorlevel 1 goto :node_fail
for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul`) do set "PATH=%%B"
echo [STEP 1] PATH refreshed >> "%LOGFILE%"
node --version >nul 2>&1
if errorlevel 1 (
    echo [STEP 1] FAIL: node not in PATH after install >> "%LOGFILE%"
    echo.
    echo  Node.js installed but PATH not updated. Open a new terminal and re-run.
    echo  Log: %LOGFILE%
    echo.
    exit /b 1
)
goto :node_ok

:upgrade_node
echo  Node.js too old. Upgrading via winget...
echo [STEP 1] Upgrading Node.js via winget... >> "%LOGFILE%"
winget upgrade --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements >> "%LOGFILE%" 2>&1
for /f "usebackq tokens=2,*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul`) do set "PATH=%%B"
node -e "process.exit(parseInt(process.version.slice(1))<18?1:0)" >nul 2>&1
if errorlevel 1 goto :node_fail
goto :node_ok

:node_fail
echo [STEP 1] FAIL: Node.js install/upgrade failed >> "%LOGFILE%"
echo.
echo  ERROR: Could not install Node.js. Install from nodejs.org then re-run.
echo  Log: %LOGFILE%
echo.
exit /b 1

:node_ok
for /f "tokens=*" %%V in ('node --version') do set NODE_VER=%%V
echo  [OK] Node.js %NODE_VER%
echo [STEP 1] OK: Node.js %NODE_VER% >> "%LOGFILE%"

:: ?? STEP 2: Claude Code CLI ???????????????????????????????????
echo.
echo  [2/4] Checking Claude Code...
echo. >> "%LOGFILE%"
echo [STEP 2] Checking Claude Code... >> "%LOGFILE%"
where claude >nul 2>&1
if not errorlevel 1 goto :claude_ok

echo  Installing Claude Code (takes ~30 seconds)...
echo [STEP 2] Installing Claude Code... >> "%LOGFILE%"
call npm install -g @anthropic-ai/claude-code >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo [STEP 2] FAIL: Claude Code install failed >> "%LOGFILE%"
    echo.
    echo  ERROR: Could not install Claude Code. Check internet. Log: %LOGFILE%
    echo.
    exit /b 1
)
echo [STEP 2] OK: Claude Code installed >> "%LOGFILE%"
goto :claude_done

:claude_ok
echo [STEP 2] OK: Claude Code already installed >> "%LOGFILE%"

:claude_done
echo  [OK] Claude Code ready.

:: ?? STEP 3: Project dependencies ??????????????????????????????
echo.
echo  [3/4] Installing project dependencies...
echo. >> "%LOGFILE%"
echo [STEP 3] Running npm install... >> "%LOGFILE%"
cd /d "%~dp0"
call npm install >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo [STEP 3] FAIL: npm install failed >> "%LOGFILE%"
    echo.
    echo  ERROR: Dependency install failed. Check internet. Log: %LOGFILE%
    echo.
    exit /b 1
)
echo  [OK] Dependencies ready.
echo [STEP 3] OK: Dependencies installed >> "%LOGFILE%"

:: ?? STEP 4: Chrome DevTools MCP ???????????????????????????????
echo.
echo  [4/4] Setting up Chrome DevTools integration...
echo. >> "%LOGFILE%"
echo [STEP 4] Adding chrome-devtools MCP... >> "%LOGFILE%"
cmd /c "claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest" >> "%LOGFILE%" 2>&1
echo [STEP 4] exit code: %ERRORLEVEL% >> "%LOGFILE%"
echo  [OK] Chrome DevTools ready.
echo [STEP 4] OK >> "%LOGFILE%"

:: ?? LAUNCH ????????????????????????????????????????????????????
echo.
echo  ============================================
echo    ALL SET! Starting Sales Agent...
echo  ============================================
echo.
echo  When the prompt appears, type:
echo.
echo      /upsell
echo.
echo  ...and press Enter to begin your website audit.
echo.

echo. >> "%LOGFILE%"
echo [LAUNCH] Starting claude... >> "%LOGFILE%"
cd /d "%~dp0"
claude
echo [LAUNCH] claude exited with code: %ERRORLEVEL% >> "%LOGFILE%"

echo.
echo  Sales Agent closed. Log: %LOGFILE%
echo.

endlocal
