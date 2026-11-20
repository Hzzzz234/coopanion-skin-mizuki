@echo off
rem 把 data\media 里按心情分好的图同步进形象包。之后桌宠会自己按心情发表情包。
setlocal
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0media.ps1" sync
if errorlevel 1 pause
if "%~1"=="" timeout /t 6 /nobreak >nul 2>nul || ping -n 7 127.0.0.1 >nul
endlocal
