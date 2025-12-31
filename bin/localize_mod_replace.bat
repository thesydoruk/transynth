@echo off
setlocal ENABLEDELAYEDEXPANSION
REM Wrapper for Windows: copy → export (xEdit) → translate (Node) → apply (xEdit).

set XEDIT=%~1
set EXPORTER=%~2
set APPLIER=%~3
set MOD=%~4
set OUTDIR=%~5
set SRCLANG=%~6
set TGTLANG=%~7
set STYLE=%~8
set GLOSSARY=%~9

if "%XEDIT%"=="" echo Usage: localize_mod_replace.bat XEDIT EXPORTER APPLIER MOD OUTDIR [SRCLANG] [TGTLANG] [STYLE] [GLOSSARY] & exit /b 1

node --version >nul 2>&1 || (echo Node is required & exit /b 1)

tsx ./src/cli/replaceFlow.ts --xedit "%XEDIT%" --exporter "%EXPORTER%" --applier "%APPLIER%" --mod "%MOD%" --outDir "%OUTDIR%" --srcLang "%SRCLANG%" --tgtLang "%TGTLANG%" --style "%STYLE%" --glossary "%GLOSSARY%"
