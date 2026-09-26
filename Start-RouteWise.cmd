@echo off
setlocal
cd /d "%~dp0"
set "ROUTEWISE_NODE=node.exe"
where node.exe >nul 2>&1
if errorlevel 1 set "ROUTEWISE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%ROUTEWISE_NODE%" "scripts\start-project.mjs" %*
exit /b %errorlevel%
