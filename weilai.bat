@echo off
REM Weilai-01 CLI launcher: forward all args to the Node entry script.
REM %~dp0 = folder of this .bat (with trailing backslash) -> bin\weilai.mjs
node "%~dp0bin\weilai.mjs" %*
exit /b %errorlevel%
