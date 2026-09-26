@echo off
setlocal
cd /d "%~dp0"
set "ROUTEWISE_NODE=node.exe"
where node.exe >nul 2>&1
if errorlevel 1 (
  set "ROUTEWISE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
if not exist "node_modules\typescript\bin\tsc" (
  echo Backend dependencies are missing. Follow the installation steps in README.md.
  exit /b 1
)
if not exist ".env" copy /y ".env.example" ".env" >nul
"%ROUTEWISE_NODE%" "node_modules\typescript\bin\tsc" -p tsconfig.build.json
if errorlevel 1 exit /b 1
"%ROUTEWISE_NODE%" "dist\src\server.js"
exit /b %errorlevel%
