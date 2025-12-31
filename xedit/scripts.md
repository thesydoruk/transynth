# xEdit scripts

- `ExportTextForTranslation.pas`: exports human-readable strings from a plugin into CSV.  
  Columns: `FormID, Signature, Path, Source, Hints` (+ можна додати `EDID`, `PathSimplified`, `Hash`).

- `ApplyTranslationsInPlace.pas`: reads CSV with translated column and writes values in-place into the plugin.

## Run examples
```bash
FO4Edit.exe -quick -autoload -fo:"C:\mods\My.esp" -app:FO4Edit -script:"ExportTextForTranslation.pas" -Argument:"My.esp|C:\work\strings.src.csv"

FO4Edit.exe -quick -autoload -fo:"C:\out\My.esp" -app:FO4Edit -script:"ApplyTranslationsInPlace.pas" -Argument:"My.esp|C:\work\strings.uk.csv"
