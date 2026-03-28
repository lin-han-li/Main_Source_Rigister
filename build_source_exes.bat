@echo off
setlocal EnableExtensions

for %%I in ("%~dp0.") do set "ROOT_DIR=%%~fI"
pushd "%ROOT_DIR%" >nul

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 20+ is required.
    set "EXIT_CODE=1"
    goto :done
)

node "%ROOT_DIR%\scripts\build-server-binary.mjs" --target win --sync-root %*
set "EXIT_CODE=%ERRORLEVEL%"

:done
popd >nul
exit /b %EXIT_CODE%
