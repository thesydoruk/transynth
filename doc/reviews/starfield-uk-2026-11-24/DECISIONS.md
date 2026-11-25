# Starfield uk translation — decisions log (2026-11-24/25)

Translation from scratch, so the log records canon decisions and unification passes rather than
review fixes. Nothing here is written to production yet.

## Before the first batch

- Player gender measured on the installed game (14 plugins, 162,028 INFO records): silent
  protagonist, one text for everyone; condition function `GetIsPronoun` branches only 45 INFOs,
  `GetIsSex` 1 (about the speaker), `GetPCIsSex` / `SameSexAsPC` 0. The importer does not read
  conditions; batches carry `player_pronoun` on those 45 lines instead.
- Decided by the user: address to the player as in FO4 — «ти / ви» per character, gender hidden
  by rephrasing, «ви» as a gender crutch forbidden.
- Canon agents (people ×2, places and organisations, gear and systems, stars and planets, UI
  core, lore) → merged canon. Core terms: UC → ОК, Freestar Collective → Колектив Вільних Зірок,
  Constellation → Сузір'я, Starborn → Зоренароджені, Unity → Єдність, Spacers → космоброди,
  Crimson Fleet → Багряний флот, Grav Drive → грав-рушій, slate → слейт, outpost → аванпост,
  credits → кредити, Digipick → цифровідмичка, Ryujin → Рюдзін, The Lock → Засув.
- Transliteration: æ → е (Paxton → Пекстон, Barron → Беррон); Japanese by Kovalenko (Ryujin →
  Рюдзін); Chinese by Palladius in the Ukrainian form (Chiang → Цзян, Chan → Чань); Arabic and
  Indian h / kh → х (Faheem → Фахім, Tahir → Тахір); Va'ruun h → г, apostrophes kept (Vaeric
  Veth'aal → Ваєрік Вет'аал); Slavic by the language of origin.
- Nicknames are translated (Bog → Багно, Wraith → Примара, Ghost → Привид, Scow → Корито).
  Company brands are transliterated; meaningful model names of ship weapons and ships are
  translated (Obliterator → Знищувач, Eradicator → Викорінювач, Vaporizer → Випаровувач,
  Starseeker → Зоряний шукач, Nullifier → Анулятор, Devastator → Нищівник).
- Quest objectives: imperative on «ти». XP → ОД. Ranks of women in the masculine form with
  agreement by sex; professions of women as feminitives (докторка Цзян, директорка Патель).

## Phase A — items, quests, prose, faces (554 batches)

- Vortex (Shattered Space) → Вихор: Брама Вихору, Породження Вихору, вихрові фантоми, Vortex
  Interlock → Вихровий блокатор.
- Emergency Kit → Аварійна аптечка; Spaced (trait) → Дитя космосу; Terra Firma → Тверда земля;
  Stealth → Скритність; Deimos Staryard(s) → Зореверф / Зореверфі "Деймос"; Sub 17 → Підрівень
  17; Auxiliary (Delta) → допоміжна одиниця; Inflictor → Каратель (Va'ruun Inflictor →
  Ва'руунський каратель, Terror Inflictor → Сіяч жаху); EIT Clothiers → Одяг "ЕІТ".
- Creatures: Floater → Плавун, Octopede → октопед, Hexapod → Шестиног, Manta → Манта.
- Junk hint dropped: an agent's `new_names` turned «Alias» (a ship) into a hint that matched
  every `<Alias=…>` tag (926 false checker hits on 135 batches).
- Reverted: Sol, Luna, Unity, Lin, Jade, Earth, Moon had been marked generic to silence checker
  false positives; generic names are not prompt hints, so they are names again.
- Alignment after the phase: three arbiters brought texts in line with the updated canon (427
  lines, about 140 names); repeated labels unified by majority, an exact canon entry wins (1,720
  lines in two rounds). 25 labels keep two translations on purpose: different records (Pan,
  Search, Bell, Display, Scrap, Melee, AP …).
- Skipped as service strings: 6,425 lines (identifiers, test cells, templates, designer notes,
  Fallout 4 leftovers). Sampled by record type: no player-facing text found.

## Phase B — dialogue (1,530 batches)

- Agents claim a batch with a marker file and skip finished ones, so overlapping streams are
  harmless; stale markers of dead agents must be cleared before a relaunch.
- LESSON: two parallel Opus streams exhausted the weekly usage limit after 1,185 batches. One
  stream finished the remaining 345 in about 80 minutes. State the token cost before a mass phase.
- Reply tags are consistent across the corpus without a pass of their own: 435 tags, 2 splits
  ([Remain silent], [Give Aurora]).
- Metadata is often wrong: `addressee: Player` on audio logs and overheard scenes; several
  companion-quest topics carry another companion as the speaker. Agents agree with the scene and
  note it.

## Unification, wave 1 (13 arbiters)

- Names: 240 names where the text lacked the canon form. Canon changed to the unanimous text
  form: Graviton Loop Array → Масив гравітонних петель; Power Interlocks → силові блокувальники
  (the Vortex Interlock stays блокатор); Butcher's Best → Бутчерз Бест; NASA Colonization Guide
  Issue N → Посібник НАСА з колонізації, випуск N; Legrande's Liquor → Напої Легранда;
  1-Of-A-Kind Salvage → брухтовий двір "Єдиний у своєму роді"; Paradiso Retirement Resort(s) →
  пансіонат(и) для пенсіонерів "Парадізо"; History of the Settled Systems - Sol Date → … — Дата
  за Сонцем. Generic: Commander's, Engineer's, Help me, This is it, Take care of them.
- Register: decisions for 171 characters (the skill's `references/registers.md`). Against the
  faction default: Ron Hope, Aja Mamasa, Killian Brice, the Clinic staff, the Newills → «ви»;
  Henry and Sarah Filburn, Hal Caruso, Tracy Warren → «ти». Asymmetric: Delta to the hero «ви»,
  the hero to Delta «ти»; Gennady Ayton «ви» / the hero «ти»; Tommy Bitlow «ви» / the hero «ти»;
  Abigail Morgan «ти» / the hero «ви». Scene-dependent: Sean McAfee, Lane Garza, Captain Myeong,
  Terran Robot, Tomisar Ka'dic (to «ти» after his defeat). Voice labels shared by several NPCs
  (Marine Male 01/02, Freestar Security, Neon Security): UC marines on duty «ви», street and
  Freestar «ти», combat barks «ти».
- Gender: all 375 detector hints checked against the scenes — false alarms (the line addresses
  another NPC, or the word is about the speaker or a third person). One register fix.
- FOUND: the detector cannot see adjective titles. Reverent → «побожний» and singular Promised
  → «Обітований» mark the hero as male in about 130 Va'ruun lines.

## Unification, wave 2 (13 arbiters)

- Reverent → «праведник» (noun title, vocative «праведнику»); singular Promised to or about the
  hero rebuilt without gender («ти з Обітованих», «Вітаю Обітованих»); false Promised →
  «самозванцю серед Обітованих».
- Jules Degante is a woman → Джулз (Jules Verne / Robert / Dubois stay Жуль; the short canon
  entry «Jules» dropped). Sahar Hasanov → Сагар Гасанова (as Sahar Raztan and as Гасанова).
  Starsap → Старсеп. Dmitri Moldavski → Дмітрій Молдавський. Muria → Мурія. Chan → Чань (Tiya
  Chan included). Patel → Патель; Director Patel is Kaia Patel → директорка Патель. Makhara →
  Махара. Neshar's surname is Osmani → Османі.
- Va'ruun: Warden(s) in Dazra → вартовий / вартова / вартові (the Lock's warden stays наглядач);
  virtues in one word everywhere — Devotion відданість, Obedience послух, Perseverance стійкість,
  Strength сила, Redemption спокута; Contemplation on … → Споглядання …; Wayshrine of … →
  Придорожнє святилище Сили / Послуху / Відданості / Стійкості / Спокути.
- Terms: Ship Services Technician → технік з обслуговування кораблів; Interstellar Affairs
  Office → Управління міжзоряних справ; shuttle → шатл; output link → вихідне з'єднання; Shield
  Generator → генератор щитів; ship EM weapon Suppressor → пригнічувач (a muzzle suppressor stays
  глушник); LIMS «(Auth N)» → «(допуск N)»; Weight Lifting tag → [Підняття ваги]; crate rat →
  щур з нетрів; Gut Buster → "Розпотрошувач"; Mantid → мантид, Plated Mantis → панцирний богомол;
  creature name suffixes follow the skin names.
- Verb-only register leftovers: 1,803 lines checked for the decided pairs, 187 changed; the
  rest are plural «ви» (the hero with a companion, a crew, a crowd) or lines said to another NPC.
- Repeated lines (same speaker, same English): 998 groups, 931 unified to one text per register.
  Ship-combat barks: a counted weapon → гармата, the state of a weapon → зброя, weapon system →
  система озброєння. Stage directions follow the English case (_chuckle_ → _посміюється_).
  «I'd like you to follow me for a while» → «Ходімо поки що разом.» for every addressee: no
  register, no gender. Kept different: 119 groups (register, addressee's known gender, another
  meaning in the scene).

## Left open

- Quotes around plain «Рюдзін» are mixed (canon: "Рюдзін Індастріз" quoted, plain Рюдзін not).
- UI key «AP» → «ПРОБ» vs the actor value short name «КИС».
- Freestar Security ship scans on «ти» in some scenes and «ви» in others.
- Ellie Yankton's greetings moved to «ви»: revert four lines if the game plays them to Barrett.
- TerraBrew Classic → «ТерраБрю Класичний» (2 of 3 texts) or «Класик».
- The new `sf1` prompts are not measured on the corpus.
