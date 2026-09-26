@echo off
call "%~dp0..\Start-RouteWise.cmd" --backend-only
exit /b %errorlevel%
