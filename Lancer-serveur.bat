@echo off
chcp 65001 >nul
title Project Beta - serveur
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est requis pour heberger une partie : https://nodejs.org ^(version LTS^)
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080"
node serveur.cjs 8080
pause
