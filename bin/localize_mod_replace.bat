@echo off
setlocal ENABLEDELAYEDEXPANSION
REM Wrapper for Windows: read ESP natively → translate (Node) → apply.

set MOD=%~1
set OUTDIR=%~2
set SRCLANG=%~3
set TGTLANG=%~4
set STYLE=%~5
set GLOSSARY=%~6

if "%MOD%"=="" echo Usage: localize_mod_replace.bat MOD OUTDIR [SRCLANG] [TGTLANG] [STYLE] [GLOSSARY] & exit /b 1

node --version >nul 2>&1 || (echo Node is required & exit /b 1)

tsx ./src/cli/replaceFlow.ts --mod "%MOD%" --outDir "%OUTDIR%" --srcLang "%SRCLANG%" --tgtLang "%TGTLANG%" --style "%STYLE%" --glossary "%GLOSSARY%"
