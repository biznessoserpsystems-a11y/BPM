@echo off
cd /d "%~dp0"
"%~dp0node.exe" "%~dp0start-server.js"
echo.
echo Server stopped. Press any key to close this window.
pause > nul
