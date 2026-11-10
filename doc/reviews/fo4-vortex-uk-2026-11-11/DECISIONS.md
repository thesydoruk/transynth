# Vortex uk translate + review, 2026-11-11

## Scope

- Untranslated after TM in current group-1 mods: 6,568 lines. 5,513 are not player-visible:
  - 3,481 PEX strings not used in MessageBox/Notification/HUD captions (log traces, compared names, animation events);
  - 883 identifier-like FULL names;
  - 1,149 markup-only lines.
  - Skipped list: `translate/skipped.json`.
- Work: 1,055 lines in 19 batches (`tr/`).

## Decisions

- WSFW "Replace Name" (WSFW_NameHolder_Settlement001–128) → "Замінити назву". No WSFW/SS2 script string contains it, so translating it is safe.
- WSFW UI terms (wsfw-tr-06): ON/OFF → УВІМК./ВИМК.; [Default] → [За замовчуванням]; Claim Settlement → Привласнити поселення; Inbox → Вхідні; Cleanup Misplaced Items → Прибрати зміщені предмети; Power Grid Tools → Інструменти електромережі; Shelter Mechanic → Механіка укриття; Options → Параметри; Suppress … → Приховувати …; Settlement Workbench → майстерня поселення.
- WSFW terms (wsfw-tr-04/05): Settlement Layout → схема поселення; Power Grid → електромережа; Progress Bars → індикатори прогресу; HUD Widgets → віджети HUD; Scrap Profile → Профіль утилізації; Threading Engine → рушій потоків; [Advanced] → [Розширене]; Max … per settler → Макс. … на поселенця.
- CONFLICTS to unify in review: Claim (settlement) — "Привласнити" (06) vs "взяти під контроль" (04); Suppress Messages — "Приховувати" (06) vs "Відкладати" (04). 17796868 `[Settings]` left Latin by 04 (unsure if sort tag) — decide in review. Context 17797087 "Options" = "Варіанти" → should be "Параметри".
- WSFW terms (wsfw-tr-07): persistence → постійність; Scrap → утилізувати; Self-Powered → автономне живлення; Manage menu → меню керування; Settlement Ownership → Власник поселення; Max Threads → Макс. потоків. Number+alias messages use the "label: value" pattern.
- CONFLICTS: Settlement Layout — "схема поселення" (04) vs "макет поселення" (07; SS2 uses "макет") → макет. Workshop Mode: "режим майстерні" (07, base FO4) vs SS2 "режим Майстерні" → count in corpus.
- Existing wrong uk in the DB (WSFW, already reviewed): 17797418 "Restore to Default" = "Скасувати"; 17797095 "Workshop Framework Options" = "Розширені параметри"; 17797087 "Options" = "Варіанти".
- SS2 terms (ss2-tr-02): Assault jumpstart → швидкий запуск штурму; team bars → смуги стану загону; enabler → об'єкт-вмикач; junk storage → склад брухту.
- MECHANICAL PASS NEEDED: existing PEX translations of glued message fragments lost their leading/trailing spaces and got a capital letter (17732893 "РІВЕНЬ", 17733009, 17733023, 17733083, 17733319, 17734017, 17734110, 17734107, 17734123, 17734139, 17734183). Check all PEX rows whose source has edge whitespace that the translation lacks. 17734306 "Powered" → "Потужна" should be "з живленням".
- BUG (TM, code): `tm_auto_numeric` matches in FallUI 219/224 swap MCM `${key}` placeholders (`${Item_sorter_help}.` → `${helpClickAction}.`; `   - ${Armor}` → `    - ${Custom_color_set_name}`). These rows are status tm → the review pass fixes them (copy the source). The TM heuristic should treat `${…}` as protected tokens — follow-up.
- Small mods: FallUI/FIS key-only lines copied as-is (their keys are translated in the mod's txt); HUDFramework protocol MESG/NNAM skipped.
- WSFW 229 existing uk is unreliable (wsfw-tr-01/08): assault quest objectives swap `<Alias=myLocation>` for non-existent aliases; MESG/TERM rows carry other lines' text ("Скасувати", "Ні, не треба", "Розширені параметри" ×6 for 17797095–100, MaxThreads BTXT = bare numbers, holder names "Університетська сукня", 17797517 aliases swapped); "Assault" = "Штурмова" → "Штурм". → Review ALL translated rows of WSFW 229 and of the small FallUI versions (217–224), not only tm-status ones.
- WSFW terms (01/08): Defend → Оборона (nominative, fills `<Alias=QuestVerb>`); Siege → Облога; Phantom Vendor → фантомний торговець; Tax Generation / Expenditure → Податкові надходження / витрати; WSFW Holding Cells → Камери утримання WSFW.
- SS2 names (ss2-tr-03): Bartlet → Бартлет; Leo → Лео; Amesbury → Еймсбері; Horatio Ziegler → Гораціо Зіглер; Taichi → Тайчі; Abramelin fields → поля Абрамеліна; Commonwealth Institute of Technology → Технологічний інститут Співдружності; UFO → НЛО; Robo Shop → Робошоп; Buzz Brain → Базз-брейн (Buzz Drain canon: Базз-дрейн).
- PEX: 378 of 382 translated PEX literals in production are names (states, animation events, stats, compared values). Export guard PR #76: only display-only literals are patched. Merge blocked for the agent (needs the user's merge). DO NOT export the langpack before #76 is merged and deployed.
- Applied 996 translations (provenance agent_translate, model claude-opus-5-5): 0 stale, 0 rejected.
- Review terms decided by corpus counts (mods 33/120–123/206): Layout → планування (13 vs схема 6, макет 4); power grid → електромережа (22 vs 5); Workshop Mode → режим майстерні (26 vs 12); Workbench → верстак (397 vs 16); Claim settlement → захопити (3).
- Review false rejection to apply manually: 17669855 FIS "Blunt" `[Прямо]` → `Ударна` (the validator's remark rule fires because the wrong old text had brackets).
- Extra fixes for the unify pass (context lines): SS2 rating letters 17682867 "СХ" → "E", 17682875 "ПД" → "S" (wrong compass TM matches).
- Buzz Brain: the ss2-tr-01/02 reviewers set 4 rows to the HQ canon «Базз-дрейн» (17672639, 17672640, 17698505, 17672925). The Ch2 terminal still reads «Базз-брейн», and SS2 225 MESG keeps «Висмоктування енергії» → corpus-wide rename = user's call.
- SPECIAL letters in SS2 disease MGEF: S «ПД» / E «СХ» (compass TM matches) → Latin S / E, unify pass.
- Open (user): "Buzz Brain" (renamed from Buzz Drain in the EN) is "Висмоктування енергії" across the SS2 corpus; the Ch2 terminal agent used "Базз-брейн". Renaming needs one pass over all rows — user's call.
- Open (user): Drugs → "Наркотики" in FIS/FallUI vs FO4 chems "Хімія".
- 17796841 WSFW_NameHolder_RenamableDummy: the uk text "Університетська сукня" replaces the source `<Token.Name=RenameMe>` and drops the token. Fix: restore the token (= source).
