{
  ExportTextForTranslation.pas
  ----------------------------
  Exports all human-readable strings from the given plugin into a CSV file.
  Columns: FormID, Signature, EDID, Path, Source, Hints
}

unit ExportTextForTranslation;

var
  outFile: TextFile;
  targetFile: string;

function Initialize: integer;
begin
  targetFile := ScriptArgs;
  if targetFile = '' then begin
    AddMessage('Usage: -Argument:"<PluginName>|<OutCsvPath>"');
    Result := 1;
    exit;
  end;

  // split arg
  var parts := TStringList.Create;
  parts.Delimiter := '|';
  parts.DelimitedText := targetFile;
  if parts.Count <> 2 then begin
    AddMessage('Expected two arguments: PluginName|OutCsvPath');
    Result := 1;
    exit;
  end;

  targetFile := parts[1];
  AssignFile(outFile, targetFile);
  Rewrite(outFile);
  Writeln(outFile, '"FormID","Signature","EDID","Path","Source","Hints"');

  Result := 0;
end;

function Process(e: IInterface): integer;
var
  rec: IInterface;
  path, sig, txt, edid: string;
begin
  sig := Signature(e);
  path := FullPath(e);

  if ElementType(e) = etString then begin
    txt := GetEditValue(e);
    if txt <> '' then begin
      // Walk up to the containing main record for EDID
      rec := e;
      while Assigned(rec) and (ElementType(rec) <> etMainRecord) do
        rec := GetContainer(rec);
      if Assigned(rec) then
        edid := EditorID(rec)
      else
        edid := '';

      Writeln(outFile,
        '"' + IntToHex(FixedFormID(e), 8) + '",'
        + '"' + sig + '",'
        + '"' + StringReplace(edid, '"','""',[rfReplaceAll]) + '",'
        + '"' + StringReplace(path, '"','""',[rfReplaceAll]) + '",'
        + '"' + StringReplace(txt, '"','""',[rfReplaceAll]) + '",'
        + '""'
      );
    end;
  end;
  Result := 0;
end;

function Finalize: integer;
begin
  CloseFile(outFile);
  Result := 0;
end;

end.
