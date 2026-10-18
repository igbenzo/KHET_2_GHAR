@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time, please wait...
  call npm.cmd install
)
start "" http://localhost:3000
node server.js
pause
