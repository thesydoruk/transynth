{
  ApplyTranslationsInPlace.pas
  ----------------------------
  Applies translations from a CSV back into the plugin file in-place.
  Expects same columns as export, with translated text in place of "Source".
}

unit ApplyTranslationsInPlace;

var
  inFile: TextFile;
  targetFile: string;
  headers: TStringList;

function Initialize: integer;
begin
  targetFile := ScriptArgs;
  if targetFile = '' then begin
    AddMessage('Usage: -Argument:"<PluginName>|<InCsvPath>"');
    Result := 1;
    exit;
  end;

  // split args
  var parts := TStringList.Create;
  parts.Delimiter := '|';
  parts.DelimitedText := targetFile;
  if parts.Count <> 2 then begin
    AddMessage('Expected two arguments: PluginName|InCsvPath');
    Result := 1;
    exit;
  end;

  targetFile := parts[1];
  AssignFile(inFile, targetFile);
  Reset(inFile);

  headers := TStringList.Create;
  var headerLine: string;
  Readln(inFile, headerLine);
  headers.Delimiter := ',';
  headers.DelimitedText := headerLine;

  Result := 0;
end;

function Process(e: IInterface): integer;
var
  line: string;
  cols: TStringList;
  formIdHex, sig, path, text: string;
begin
  if Eof(inFile) then begin
    Result := 1;
    exit;
  end;

  Readln(inFile, line);
  cols := TStringList.Create;
  cols.StrictDelimiter := true;
  cols.Delimiter := ',';
  cols.DelimitedText := line;

  if cols.Count < 4 then begin
    Result := 0;
    exit;
  end;

  formIdHex := cols[0];
  sig := cols[1];
  path := cols[2];
  text := cols[3];

  if (Signature(e) = sig) and (IntToHex(FixedFormID(e), 8) = formIdHex) and (FullPath(e) = path) then begin
    if ElementType(e) = etString then
      SetEditValue(e, text);
  end;

  Result := 0;
end;

function Finalize: integer;
begin
  CloseFile(inFile);
  headers.Free;
  Result := 0;
end;

end.
