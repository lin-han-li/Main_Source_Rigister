@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONLEGACYWINDOWSSTDIO=1"
cd /d "%~dp0"

set "DISPLAY_TITLE=OpenAI Register Full"
title %DISPLAY_TITLE%

if /I "%~1"=="--help" goto :usage
if /I "%~1"=="-h" goto :usage

call :resolve_python
if errorlevel 1 goto :fail

%PYTHON_CMD% -c "import curl_cffi, requests" >nul 2>&1
if errorlevel 1 goto :deps_missing

set "SCRIPT_ARGS="
if not "%~1"=="" (
    call :is_positive_int "%~1"
    if not errorlevel 1 (
        set "SCRIPT_ARGS=-n %~1"
        shift
    )
)

:collect_args
if "%~1"=="" goto :run_script
set "SCRIPT_ARGS=%SCRIPT_ARGS% %~1"
shift
goto :collect_args

:run_script
echo ==================================================
echo %DISPLAY_TITLE%
echo Script : register_success.py
echo Workdir: %CD%
echo Python : %PYTHON_CMD%
if defined SCRIPT_ARGS (
    echo Args   : %SCRIPT_ARGS%
) else (
    echo Args   : ^(none - use script interactive prompts^)
)
echo ==================================================
echo.

%PYTHON_CMD% register_success.py %SCRIPT_ARGS%
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo Finished successfully.
) else (
    echo [ERROR] register_success.py exited with code %EXIT_CODE%.
)

pause
exit /b %EXIT_CODE%

:usage
echo Usage:
echo   %~nx0
echo   %~nx0 3
echo   %~nx0 -n 3 -w 2 --proxy http://127.0.0.1:7897
echo   %~nx0 --no-proxy --skip-preflight
echo.
echo Notes:
echo   - No argument: use register_success.py interactive prompts.
echo   - First numeric argument is converted to "-n COUNT" for compatibility.
echo   - All other options are passed through to register_success.py.
exit /b 0

:is_positive_int
setlocal
set "VALUE=%~1"
if not defined VALUE (
    endlocal & exit /b 1
)
for /f "delims=0123456789" %%A in ("%VALUE%") do (
    endlocal & exit /b 1
)
if "%VALUE%"=="0" (
    endlocal & exit /b 1
)
2>nul set /a TEST=%VALUE%
if errorlevel 1 (
    endlocal & exit /b 1
)
endlocal & exit /b 0

:deps_missing
echo [ERROR] Missing Python dependencies.
echo Run this in the current folder:
echo %PYTHON_CMD% -m pip install -r requirements.txt
goto :fail

:resolve_python
if exist "%CD%\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=\"%CD%\.venv\Scripts\python.exe\""
    exit /b 0
)

if exist "%CD%\..\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=\"%CD%\..\.venv\Scripts\python.exe\""
    exit /b 0
)

where python >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=python"
    exit /b 0
)

where py >nul 2>&1
if not errorlevel 1 (
    py -3.11 -c "import sys" >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=py -3.11"
        exit /b 0
    )
    py -3 -c "import sys" >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=py -3"
        exit /b 0
    )
    set "PYTHON_CMD=py"
    exit /b 0
)

echo [ERROR] Python launcher not found.
echo Install Python 3.11+ and retry.
exit /b 1

:fail
pause
exit /b 1
