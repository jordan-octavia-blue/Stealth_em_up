@echo off
REM Builds the Odin + Sokol port of Stealth em Up on Windows (OpenGL backend).
REM   odin\build.bat          -> odin\bin\stealth_em_up.exe
REM   odin\build.bat run      -> build and run from the repo root
REM   odin\build.bat debug    -> build with -debug (keeps the console window)
REM Needs odin and git on PATH, plus the Visual Studio C++ build tools (which Odin
REM already needs for linking). Sokol's C libraries are compiled once, on the first build.
setlocal EnableDelayedExpansion
set HERE=%~dp0
set HERE=%HERE:~0,-1%
set SOKOL_COMMIT=60dd3a7c55246cca9a6cf2d34664a8861414f0fe
if "%SOKOL_ODIN_DIR%"=="" (set SOKOL_DIR=%HERE%\third_party\sokol-odin) else (set SOKOL_DIR=%SOKOL_ODIN_DIR%)
set S=%SOKOL_DIR%\sokol

where odin >nul 2>nul || (echo error: 'odin' not found on PATH & exit /b 1)

if not exist "%S%\c\sokol_app.h" (
  where git >nul 2>nul || (echo error: 'git' is needed to fetch sokol-odin & exit /b 1)
  git clone https://github.com/floooh/sokol-odin "%SOKOL_DIR%" || exit /b 1
  git -C "%SOKOL_DIR%" checkout -q %SOKOL_COMMIT% || exit /b 1
)

set NEED_CL=0
for %%m in (log app gfx glue time gl) do if not exist "%S%\%%m\sokol_%%m_windows_x64_gl_release.lib" set NEED_CL=1
if not exist "%HERE%\build\sokol_audio_windows_x64.lib" set NEED_CL=1

if "%NEED_CL%"=="1" (
  where cl >nul 2>nul
  if errorlevel 1 (
    set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
    if not exist "!VSWHERE!" goto :no_msvc
    for /f "usebackq delims=" %%i in (`"!VSWHERE!" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VSPATH=%%i
    if "!VSPATH!"=="" goto :no_msvc
    call "!VSPATH!\VC\Auxiliary\Build\vcvars64.bat" >nul || goto :no_msvc
  )
  if not exist "%HERE%\build" mkdir "%HERE%\build"
  for %%m in (log app gfx glue time gl) do (
    if not exist "%S%\%%m\sokol_%%m_windows_x64_gl_release.lib" (
      echo cl sokol_%%m
      cl /nologo /c /O2 /DNDEBUG /DIMPL /DSOKOL_GLCORE "%S%\c\sokol_%%m.c" /Fo"%HERE%\build\sokol_%%m.obj" >nul || exit /b 1
      lib /nologo /OUT:"%S%\%%m\sokol_%%m_windows_x64_gl_release.lib" "%HERE%\build\sokol_%%m.obj" || exit /b 1
    )
  )
  if not exist "%HERE%\build\sokol_audio_windows_x64.lib" (
    echo cl sokol_audio
    cl /nologo /c /O2 /DNDEBUG /DIMPL "%S%\c\sokol_audio.c" /Fo"%HERE%\build\sokol_audio.obj" >nul || exit /b 1
    lib /nologo /OUT:"%HERE%\build\sokol_audio_windows_x64.lib" "%HERE%\build\sokol_audio.obj" || exit /b 1
  )
)

if not exist "%HERE%\bin" mkdir "%HERE%\bin"
set FLAGS=-collection:sokol="%S%" -collection:physics="%HERE%\physics" -define:SOKOL_USE_GL=true -out:"%HERE%\bin\stealth_em_up.exe"
if "%1"=="debug" (set FLAGS=%FLAGS% -debug) else (set FLAGS=%FLAGS% -o:speed -subsystem:windows)
odin build "%HERE%\game" %FLAGS% || exit /b 1
echo built %HERE%\bin\stealth_em_up.exe
if "%1"=="run" (
  pushd "%HERE%\.."
  "%HERE%\bin\stealth_em_up.exe"
  popd
)
exit /b 0

:no_msvc
echo error: the MSVC C compiler (cl.exe) was not found.
echo Install "Build Tools for Visual Studio" with the "Desktop development with C++" workload,
echo or run this script from the "x64 Native Tools Command Prompt for VS".
exit /b 1
