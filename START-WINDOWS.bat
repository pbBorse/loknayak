@echo off
title Loknayak Server
cd /d "%~dp0"
echo Starting Loknayak... open http://localhost:3000 in your browser
node server.js
pause
