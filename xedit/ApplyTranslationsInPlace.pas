{
  ApplyTranslationsInPlace.pas
  ----------------------------
  Applies translations from a CSV back into the plugin file in-place.
  Expects same columns as export, with translated text in place of "Source".
  The entire CSV is loaded into a FormID+Path → translation map during
  Initialize so that Process() does O(1) lookup regardless of element order.
}

unit ApplyTranslationsInPlace;

var
  // Key = "FORMID|PATH", Value = translated text
  translationMap: TStringList;
  targetFile: string;

function ParseCsvLine(const line: string): TStringList;
var
  result_list: TStringList;
  i, len: integer;
  ch: char;
  field: string;
  inQuotes: boolean;
begin
  result_list := TStringList.Create;
  len := Length(line);
  field := '';
  inQuotes := false;
  i := 1;
  while i <= len do begin
    ch := line[i];
    if inQuotes then begin
      if (ch = '"') and (i < len) and (line[i + 1] = '"') then begin
        field := field + '"';
        Inc(i, 2);
      end else if ch = '"' then begin
        inQuotes := false;
        Inc(i);
      end else begin
        field := field + ch;
        Inc(i);
      end;
    end else begin
      if ch = '"' then begin
        inQuotes := true;
        Inc(i);
      end else if ch = ',' then begin
        result_list.Add(field);
        field := '';
        Inc(i);
      end else begin
        field := field + ch;
        Inc(i);
      end;
    end;
  end;
  result_list.Add(field);
  Result := result_list;
end;

function ColIndex(headers: TStringList; const name: string): integer;
var
  i: integer;
begin
  Result := -1;
  for i := 0 to headers.Count - 1 do
    if LowerCase(Trim(headers[i])) = LowerCase(name) then begin
      Result := i;
      exit;
    end;
end;

function Initialize: integer;
var
  csvPath: string;
  parts, headers, cols: TStringList;
  inFile: TextFile;
  headerLine, line, formId, path, text: string;
  iFormId, iPath, iSource: integer;
  key: string;
begin
  Result := 0;

  var args := ScriptArgs;
  if args = '' then begin
    AddMessage('Usage: -Argument:"<PluginName>|<InCsvPath>"');
    Result := 1;
    exit;
  end;

  parts := TStringList.Create;
  parts.Delimiter := '|';
  parts.DelimitedText := args;
  if parts.Count <> 2 then begin
    AddMessage('Expected two arguments: PluginName|InCsvPath');
    Result := 1;
    exit;
  end;

  csvPath := parts[1];
  parts.Free;

  if not FileExists(csvPath) then begin
    AddMessage('CSV file not found: ' + csvPath);
    Result := 1;
    exit;
  end;

  translationMap := TStringList.Create;
  translationMap.Duplicates := dupIgnore;

  AssignFile(inFile, csvPath);
  Reset(inFile);

  // Read header
  Readln(inFile, headerLine);
  headers := ParseCsvLine(headerLine);
  iFormId := ColIndex(headers, 'formid');
  iPath   := ColIndex(headers, 'path');
  iSource := ColIndex(headers, 'source');
  headers.Free;

  if (iFormId < 0) or (iPath < 0) or (iSource < 0) then begin
    AddMessage('CSV missing required columns (FormID, Path, Source)');
    CloseFile(inFile);
    Result := 1;
    exit;
  end;

  // Load all rows into map
  while not Eof(inFile) do begin
    Readln(inFile, line);
    if Trim(line) = '' then continue;
    cols := ParseCsvLine(line);
    if cols.Count > iSource then begin
      formId := cols[iFormId];
      path   := cols[iPath];
      text   := cols[iSource];
      key    := formId + '|' + path;
      translationMap.Values[key] := text;
    end;
    cols.Free;
  end;

  CloseFile(inFile);
  AddMessage(Format('ApplyTranslations: loaded %d entries from %s', [translationMap.Count, csvPath]));
end;

function Process(e: IInterface): integer;
var
  formIdHex, path, key, text: string;
begin
  Result := 0;

  formIdHex := IntToHex(FixedFormID(e), 8);
  path      := FullPath(e);
  key       := formIdHex + '|' + path;

  text := translationMap.Values[key];
  if text = '' then exit;

  if ElementType(e) = etString then
    SetEditValue(e, text);
end;

function Finalize: integer;
begin
  translationMap.Free;
  AddMessage('ApplyTranslations: done.');
  Result := 0;
end;

end.
