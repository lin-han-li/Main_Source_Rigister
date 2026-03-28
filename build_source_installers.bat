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

if not exist "%ROOT_DIR%\node_modules\yaml\package.json" (
    call npm ci
    if errorlevel 1 (
        set "EXIT_CODE=%ERRORLEVEL%"
        goto :done
    )
)

node "%ROOT_DIR%\scripts\build-desktop.mjs" --target win %*
set "EXIT_CODE=%ERRORLEVEL%"

:done
popd >nul
exit /b %EXIT_CODE%
