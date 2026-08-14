@ECHO off
SETLOCAL
SET "ROOT=%~dp0.."

IF EXIST "%ROOT%\node-runtime\node.exe" IF EXIST "%ROOT%\lib\oh-dsh\cli.js" (
  SET "DSH_OH_WEB_ROOT=%ROOT%"
  "%ROOT%\node-runtime\node.exe" "%ROOT%\lib\oh-dsh\cli.js" %*
  EXIT /B %ERRORLEVEL%
)

IF NOT EXIST "%ROOT%\dist\ohdsh.js" (
  ECHO Oh-DSH is not built. Run pnpm run build first. 1>&2
  EXIT /B 1
)

SET "OH_DSH_SOURCE_ROOT=%ROOT%"
node "%ROOT%\dist\ohdsh.js" %*
