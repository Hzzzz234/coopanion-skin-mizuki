@echo off
rem 在桌面放一个「发送表情包」的快捷方式,以后双击它就行。
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0media.ps1" shortcut
if errorlevel 1 pause
endlocal