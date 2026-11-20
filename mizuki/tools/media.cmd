@echo off
rem 打开 Coopanion 与它的 data\media,并让桌宠从 media 里随手挑一张图举到身边。
rem 用法: 双击 = 打开文件夹 + 发射一张;  media.cmd open / fire / list
setlocal
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0media.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [exit %RC%]
  pause
  goto :eof
)
rem 双击运行时留一点时间看输出
if "%~1"=="" (
  timeout /t 5 /nobreak >nul 2>nul || ping -n 6 127.0.0.1 >nul
)
endlocal