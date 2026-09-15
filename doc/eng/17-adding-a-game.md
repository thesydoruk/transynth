# Adding a Game

A game is a **plugin**: one directory under `src/games/` that implements the
contract in `src/games/contract`, plus one line registering it in
`src/games/index.ts`.

Nothing outside that directory changes. There is no `switch (game)` anywhere in
the pipeline, no `Record<GameId, …>` map to extend, and no game id compared to a
literal in shared code — the import, export, voice, prompt, and editor layers all
ask the plugin.

---

## The two kinds of game

**A Creation Engine title** (Fallout, Elder Scrolls) already has its whole
pipeline written. Adding one is a _descriptor_, not code:

```ts
// src/games/creation-engine/titles/fallout.ts
export const fallout4: CreationEngineTitle = {
  id: 'fo4',
  catalogue: { name: 'Fallout 4', developer: '…', releaseYear: 2015, … },
  subrecords: compileSubrecordConfig(fo4Subrecords),  // which fields hold text
  recorddefs: compileRecorddefs([fo4Recorddefs]),     // which STRINGS table
  archive: { kind: 'ba2', bsaVersion: 104 },
  strings: { lookupOrder: ['loose', 'ba2'], officialLocales: FO4_LOCALES },
  voice: { faceFxTitle: 'Fallout4', packLangpackVoiceIntoBa2: true },
  deployment: { officialMasters: [...], vortexId: 'fallout4', exeName: 'Fallout4.exe' },
  prompts: { … },
};
```

Register it and you are done:

```ts
// src/games/index.ts
registerGamePlugin(createCreationEnginePlugin(starfield));
```

**Anything else** — a different engine, a different file format — is a plugin
directory of its own. `src/games/disco-elysium/` is the worked example: a Unity
game with no plugin format, no archives, and no string tables, whose
localization is a folder of gettext `.po` catalogues and loose `.wav` takes.

---

## What a plugin declares

| Adapter      | Answers                                                                                              | Required |
| ------------ | ---------------------------------------------------------------------------------------------------- | -------- |
| `catalogue`  | Title, developer, year, engine label, NexusMods ids                                                  | yes      |
| `editor`     | Which editor tabs, grid columns, and actions this game's mods get                                    | yes      |
| `text`       | Markup the LLM must mirror, censorship to undo, protected keywords, what kind of text a record holds | yes      |
| `prompts`    | Ukrainian prompts, English rule sections, glossary, optional 2nd pass                                | yes      |
| `import`     | Which file anchors an upload, how big it is, how to ingest it                                        | yes      |
| `export`     | The langpack payload and the full-mod ZIP                                                            | yes      |
| `dialog`     | Who speaks a line, who they speak to, and whether the protagonist's gender is fixed                  | no       |
| `voice`      | How takes are named, found, and synthesized                                                          | no       |
| `deployment` | Masters, load order, Vortex id — for mod-manager deployment                                          | no       |

Leave an optional adapter out and the feature disappears cleanly: a silent game
gets no Voice tab and no voice jobs, a game no mod manager deploys is skipped by
the Vortex scan, and a game with no `dialog` adapter has lines with no
participants — which the prompt reads as "not dialogue", not as "dialogue whose
speaker we lost".

`dialog` is the one adapter that contributes SQL. Both `participantsSql` (who
speaks a line and to whom) and `lineSpeakerSql` (what the string grid shows in
its speaker column) become branches of a lateral join shared by every game, so
each must restrict itself to the `gameList` it is handed — a single query may
span mods of several games at once. `lineSpeakerSql` is optional and answers a
wider question than the other: for Creation Engine it also covers a record that
merely _names_ an actor, because a translator needs that actor's gender to
decline the name.

Whether the protagonist's gender is chosen (`any`, every Bethesda title) or
written (Disco's Harry is male) is declared here too, in `playerGender`, because
hedging a written character reads as a mistranslation. `isSpokenSignature` says
which of the game's record types are lines somebody says aloud; shared code asks
it instead of testing for `INFO`.

---

## Step by step

1. **Create the directory.** `src/games/<your-game>/` with a `plugin.ts`
   exporting a `GamePlugin`.

2. **Catalogue and editor.** Fill in the tile metadata and say which screens the
   editor should show. The API serves both to the browser, so the UI needs no
   change — including the file types the upload picker offers, which come from
   `import.uploadExtensions`.

3. **Import.** Implement three functions:
   - `selectAnchor(extractDir)` — which file inside an uploaded archive the
     import is anchored to, or `null` when the archive holds nothing you read.
   - `describeAnchor(anchorPath, extractRoot)` — is the text external, and how
     many records to expect.
   - `ingest(ctx)` — read the mod, write records and strings, then call the
     shared `finalizeModImport`. Honour `ctx.state.cancel` / `ctx.state.pause`
     between batches so a paused job resumes cleanly.

4. **Export.** `collectLangpackEntries(ctx)` returns the loose localized files;
   `exportFullModZip(ctx)` returns the whole mod with translations applied. A
   game whose distribution shape is the same for both points them at one
   implementation.

5. **Voice, if the game is voiced.** The adapter owns take naming, discovery,
   the mod-wide synthesis job, single-line synthesis, and the catalog behind the
   editor's Voice tab.

6. **Prompts.** A Ukrainian translate and verify prompt, the English rule
   sections, and a glossary. If your game's text has nothing in common with the
   shared rule bullets (records, item rarities, gear-name templates), set
   `english.useCommonRules: false` and supply your own.

7. **Register it** in `src/games/index.ts`. Registration order is catalogue
   order.

---

## What to check

`src/games/__tests__/registry.test.ts` asserts that every registered plugin has
the adapters the pipeline calls unconditionally, so a half-finished plugin fails
the suite rather than the first import.

Beyond that, colocate tests with your plugin under
`src/games/<your-game>/__tests__/`, the way Disco Elysium does.

---

## Rules the layout depends on

- **Shared code never names a game.** If you find yourself adding
  `game === 'x'` outside `src/games/`, the thing you are branching on belongs in
  the contract instead.
- **Nor one game's record types.** `grup === 'TERM'` is the same mistake
  wearing a different hat: it is false for every game but one, so every other
  game silently takes the else branch. Ask `text.recordKind(grup, field)` and
  add a kind if the distinction you need is genuinely new. `src/formats/**` and
  the Bethesda import and query modules are that engine's own domain and keep
  their vocabulary; `src/llm`, `src/utils`, `src/dialog` and the worker do not,
  and a test enforces it.
- **Code used by exactly one plugin lives inside it.** Code shared by several
  lives in the libraries (`src/formats`, `src/import`, `src/voice`,
  `src/web/export`) and takes explicit parameters, never a game id it
  interprets.
- **Look plugins up through `src/games/registry`.** That module imports no
  plugin, so it cannot form an import cycle. Only entry points — the API server,
  the worker, each script, the Jest setup file — import `src/games` itself,
  which is what performs the registration.

---

← [Vortex Sync](16-vortex-sync.md) | [Home](README.md)
