# Vocal-effort tags — working plan

Branch: `feat/vocal-effort-tags`. This file is a handoff note for whoever continues the
branch. Delete it (or fold the outcome into `doc/*/09-voice.md`) before the branch merges.

## Problem

Fish Speech S2 Pro clones shouted and screamed lines flat: the take comes out as raised
talking, not a shout. Pure vocalizations (`Agh!`, `*Sigh*`) are not part of this — they are
already skipped as `phonetic_vocalization` and keep the original audio.

## What we think causes it

Read off the code, none of it measured yet. Listed by how cheap it is to check.

1. **S2 inline tags never reach the model.** `prepareVoiceTtsText.ts` strips every `[...]`
   block as game markup, and nothing adds `[shouting]` / `[screaming]` afterwards. S2's main
   lever for expression is unused.
2. **The Ukrainian LoRA may have flattened expression.** If its dataset is mostly read
   speech, it pulls prosody toward that register and may also have weakened tag following.
3. **Short lines get calm padding.** Combat barks are short, so they take the `short` branch
   of `decideVoiceReferenceSource`, where extra speaker clips are appended. If those are
   conversational they outweigh the shouted line clip. `scoreReferenceWav` may also reject
   shouted clips outright through its clip-ratio penalty.
4. **Sampling is fixed at vLLM startup** (`fish-studio/configs/fish_speech_deploy.yaml`:
   temperature 0.9, top_p 0.8, top_k 40) for every line. That may be too narrow for shouts.
5. **Take selection ignores effort.** Retries are ranked by voice similarity only.

Items 2 and 4 live in `thesydoruk/fish-studio`, not here.

## Done on this branch

Detection only. Nothing is wired into synthesis.

- `src/voice/vocalEffort/features.ts` — per-clip median pitch (semitones) and high-band
  emphasis of the voiced frames. Both ignore level on purpose: shipped voice files are
  normalized.
- `src/voice/vocalEffort/baseline.ts` — per-speaker median/MAD baseline and z-scores. The
  caller passes the speaker's **calm** clips, not all of them (see step 1).
- `src/voice/vocalEffort/decide.ts` — two gates → `shouting` / `loud` / none: the clip
  must sound pushed (the weaker of the pitch and brightness z-scores), and for `shouting`
  the line must say so (`!` or a shout in the actor note). Plus `applyEffortTag` (not
  called anywhere yet).
- `scripts/scanVocalEffort.ts` (`npm run voice:scan-effort -- <dir> [--calm=<file>]`) —
  ranks a folder of decoded 16-bit WAVs laid out as `<speaker>/<clip>.wav`, prints TSV.
  `--calm` lists the clips a baseline may be built from. Acoustic gate only.
- Tests: `src/voice/vocalEffort/__tests__/vocalEffort.test.ts`.

**Verified:** lint, `tsc`, Prettier, 17 tests; the acoustic score against proxy labels on
8,030 real clips (step 1); the tagging rule against 160 lines labelled by ear (step 4).
**Not verified:** that a tag changes what the model says — nothing has been synthesized
with one. The labels are one listener's single pass over five voice types.

## Next steps

Do them in order; each one decides whether the next is worth doing.

### 1. Check that the acoustic features separate shouts on real clips — measured 2026-11-27

Corpus: every clip of `RaiderMale01`, `RaiderFemale01`, `NPCMPrestonGarvey`, `NPCFPiper`
and `NPCFCait` from a local `Fallout4 - Voices.ba2` (8,055 clips, 8,030 analyzable), each
joined to its `Fallout4.esm` line: `DIAL` subtype and category, `TRDA` emotion, `NAM2` note,
English text. Before anyone listened, two proxy label pairs stood in for ears, over the
7,810 spoken lines:

- _note pair_ — the actor note says shout / yell / scream (140) against a note that says
  quiet, calm, whisper and the like (153);
- _combat pair_ — a combat-topic line with `!` (390) against a greeting / idle / scene line
  without `!` (6,128).

| acoustic score                          | AUC note / combat | reach 2.0: shout notes / combat lines | calm lines ≥ 2.0 |
| --------------------------------------- | ----------------- | ------------------------------------- | ---------------- |
| as first written                        | 0.83 / 0.83       | 16 % / 30 %                           | 5.0 %            |
| median pitch + voiced-frame brightness  | 0.88 / 0.86       | 14 % / 31 %                           | 2.1 %            |
| the same, baseline from calm clips only | 0.97 / 0.98       | 90 % / 93 %                           | 4.8 %            |

What the first version got wrong, and what changed on the branch:

- **The baseline was every clip of the speaker.** A raider voice type is mostly combat
  barks: its median clip sits 8 semitones above its own idle lines, so its shouts scored as
  ordinary (0 of 266 raider combat lines reached 2.0). Shouts of all five voices land in the
  same place — 18–26 semitones above 100 Hz, male and female alike. The baseline is now
  built from calm clips. Which clips are calm comes from the plugin (`DIAL` category), so
  step 3 is a prerequisite of the baseline, not only a source of hints. A text-only choice
  (lines without `!`) is not enough: 41 % / 64 % reach 2.0.
- **The upper pitch tail (p90) hurt** — AUC 0.89 against 0.96 for the median; octave errors
  land there. Removed.
- **Brightness over every active frame scored hiss as effort** ("Shh shh!", "Chicken
  shit."). Over voiced frames only: AUC 0.89 → 0.97 on the note pair.

**By ear (2026-11-27).** 160 clips sampled across the score range were labelled blind:
23 shout, 56 raised voice, 81 calm. Every shout scored 2.25 or more, so the features pass:
nothing shouted hides among the low scores. The score alone does not: weighted back to the
corpus, a third of the lines at 2.0 or more are shouts, three quarters a shout or a raised
voice, and a quarter calm — mostly short high-pitched lines of the companions ("Here.",
"Let's rock.", "I knew it."). Step 4 turns that into the tagging rule.

Still open:

- Short clips are the noisy ones: 17 % of calm-topic clips under half a second reach 2.0,
  1 % of those over four seconds.
- Robots, creatures, radio-filtered and child voice types were not in the corpus.

Tooling (reads the game folder, writes only to its output folder): `buildCorpus.mts`,
`calmList.mjs`, `evalScan.mjs`, `buildListenPage.mjs`, `labels.mjs`, `finalRule.mjs` and
the labels themselves in `transynth-review-archive/pending/vocal-effort/`.

### 2. A/B the model before building more — measured 2026-11-27, with the LoRA only

Ten lines labelled as shouts in step 1 (five voice types), sent to the live gateway the way
the pipeline sends them: the line's own clip as the reference, its English text as
`speaker_text`, `language=uk`, `match_loudness` and `match_timing` on. Three takes each
without a tag, with `[shouting]` and with `[screaming]`; 110 requests, none failed, no
synth warnings. The Ukrainian texts were written for the test, not taken from production.
Each take was scored with the step 1 features against its speaker's calm baseline.

| per-line mean of three takes  | pitch        | brightness | strength | takes at strength ≥ 2 |
| ----------------------------- | ------------ | ---------- | -------- | --------------------- |
| no tag                        | —            | —          | —        | 6 of 30               |
| `[shouting]` − no tag         | +5.3 st      | +1.7 dB    | +0.88    | 14 of 30              |
| `[screaming]` − no tag        | +4.8 st      | +1.2 dB    | +0.65    | 12 of 30              |
| original − no tag             | +5.6 st      | +3.1 dB    | +1.59    |                       |
| lines where the tag raised it | 10 / 9 of 10 | 9 / 8      | 9 / 8    |                       |

- **The tag reaches the model and works with the LoRA on.** `[shouting]` closes nearly all
  of the pitch gap to the original and about half of the brightness gap. Voice similarity
  did not drop (+0.07).
- **The flat-shout problem is real and uneven.** Without a tag four of the ten lines came
  out at the strength of calm speech (0 against 2.1–2.6 in the original), three kept
  most of the shout from the reference alone.
- **`[screaming]` adds nothing** over `[shouting]` and is less consistent.
- **No sign that the tag is read aloud.** With `match_timing` off, tagged takes ran 0.24 s
  longer on average with a spread of 0.9 s — not a consistent extra word.
- Takes of one line differ by about 0.7 in strength, so ranking retries by effort (step 5)
  would add to the tag.

**By ear (2026-11-27).** The 90 takes were rated blind, conditions hidden:

| condition     | shout | raised voice | calm | rejected |
| ------------- | ----- | ------------ | ---- | -------- |
| no tag        | 0     | 9            | 19   | 2        |
| `[shouting]`  | 12    | 16           | 1    | 1        |
| `[screaming]` | 16    | 12           | 2    | 0        |

- **Pass.** Not one untagged take of a shouted line was heard as a shout; with either tag
  all ten lines moved up, and only 3 of 60 tagged takes stayed calm. No take was rejected
  for speaking the tag.
- **One tag is enough.** `[screaming]` beat `[shouting]` on four lines, tied on four and
  lost on two; the listener found the two close to identical in places.
- **The features hear what the listener hears.** Strength separates takes rated shout from
  takes rated calm with AUC 0.88, so it can rank retries.
- **A leaked reference scores as a perfect clone.** The three rejected takes spoke the
  reference's English text, all on one line ("Agh! Me arm's been hit…"), with voice
  similarity 0.70–0.87; the highest of the 87 accepted takes is 0.54. `pickBestTake` keeps
  the most similar take, so it would have kept the leak twice. See step 5.

**`[loud]` (2026-11-27).** Ten lines labelled a raised voice in step 1 — five the rule
tags `loud`, three it tags `shouting`, two it leaves alone — three takes each without a
tag, with `[loud]` and with `[shouting]`; 90 requests, none failed, no leaked reference.

| per-line mean of three takes | pitch   | brightness | strength | takes at strength ≥ 2 |
| ---------------------------- | ------- | ---------- | -------- | --------------------- |
| no tag                       | —       | —          | —        | 2 of 30               |
| `[loud]` − no tag            | +3.6 st | +1.4 dB    | +0.84    | 9 of 30               |
| `[shouting]` − no tag        | +5.7 st | +2.3 dB    | +1.37    | 14 of 30              |
| original − no tag            | +6.1 st | +4.0 dB    | +2.18    |                       |

`[loud]` is a real, milder level: it raised nine lines of ten, and `[shouting]` went
further on nine of ten (+2.1 st over `[loud]`). Neither overshoots the original by these
measures — even `[shouting]` stays 0.8 below it in strength.

Rated blind, the target here being a raised voice:

| condition    | shout | raised voice | calm |
| ------------ | ----- | ------------ | ---- |
| no tag       | 0     | 3            | 27   |
| `[loud]`     | 5     | 13           | 12   |
| `[shouting]` | 10    | 16           | 4    |

- **Raised voices come out flat too** — 27 of 30 untagged takes were heard as calm, so the
  problem is not only the shouts.
- **`[loud]` errs toward calm, `[shouting]` toward a shout.** `[loud]` leaves four takes in
  ten calm and turns one in six into a shout; `[shouting]` leaves one in eight calm and
  turns a third into a shout. Neither lands on "raised" much more than half the time.
- **The `loud` tier stays.** On the five lines the rule tags `loud`, `[loud]` gave 2 / 7 / 6
  against 0 / 1 / 14 without a tag, and its misses are the flat takes we have today.
- **A raised voice tagged `[shouting]` is not a disaster.** On the three such lines the
  takes were 2 / 4 / 3 — no more shouts than `[loud]` gave them (3 / 1 / 5).
- **Takes of one line still differ a lot** (the same tag gives calm, raised and shout).
  Keeping the take closest in strength to the original left no calm take on these lines
  (`[loud]` 3 / 7 / 0, against 1 / 5 / 4 for the most similar voice, which is what the gate
  keeps today), but on the shouted lines it kept fewer shouts (4 of 10 against 7): shouted
  takes are also the more similar ones there. Ten lines each way — not enough to change
  the ranking.

**Several tags (2026-11-27).** Fish Audio documents them — `[angry][shouting] Get out of
here now!`, free-form wording, up to three per sentence. On the ten shouted lines, three
takes each, first by the step 1 features:

| against `[shouting]` alone | pitch   | brightness | strength | takes at strength ≥ 2 |
| -------------------------- | ------- | ---------- | -------- | --------------------- |
| `[loud] [shouting]`        | +0.4 st | 0.0 dB     | 0.0      | 15 of 30 (14)         |
| `[angry] [shouting]`       | −1.5 st | −0.2 dB    | −0.1     | 11 of 30              |
| `[angry shouting]`         | −1.1 st | −0.3 dB    | −0.1     | 12 of 30              |

Stacking adds no effort: `[loud] [shouting]` is `[shouting]`, and anger lowers the pitch a
little without raising anything. No extra duration, so the tags are not read aloud.

The ear agrees. Rated blind next to the `[shouting]` takes of the first round (shout /
raised voice / calm / rejected): `[shouting]` 10 / 18 / 1 / 1, `[loud] [shouting]`
14 / 14 / 2 / 0, `[angry] [shouting]` 11 / 15 / 3 / 1, `[angry shouting]` 9 / 19 / 2 / 0.
Per line none of the three differs from `[shouting]` (up on 5, 3 and 2 lines of ten, down
on 2, 2 and 3). One tag is what the pipeline sends.

Two things the second rating of the same 30 `[shouting]` takes shows:

- **The listener is consistent where it matters.** 26 of 30 got the same label; the four
  that changed moved between shout and raised voice, none to or from calm.
- **The leak ceiling sits between 0.61 and 0.70.** The two takes rejected for English text
  were rejected again (similarity 0.80 and 0.85); a take at 0.605 was a good shout.

Not done: the same without the LoRA (it needs a change on the GPU host, and the question
it was to answer is settled — tags work with the LoRA on). Requests are `abTags.mjs`,
scoring `abMeasure.mts` and `abCompare.mjs`, the page `buildAbPage.mjs`, ratings
`abLabels.mjs` and `abPick.mjs`, all in the archive folder of step 1.

### 3. Read the plugin-side hints

Two things have to come from the plugin, and nothing parses them yet: the topic category,
to pick the calm clips of a baseline, and the actor note, which `decideVocalEffort` takes
as a cue. The FO4 layouts below were read off `Fallout4.esm` by the step 1 tooling (all
74,996 `TRDA` are 20 bytes); Starfield's are still from memory. The shares are of the 7,810
spoken lines of step 1 whose acoustic score reaches 2.0; the counts are labelled lines,
shout / raised voice / calm.

- **Topic category — for the baseline.** `DIAL` `DATA` byte 1 is the category, `SNAM` the
  four-letter subtype. Combat (category 3: `ATCK`, `TAUT`, `CRIL`, `FLBK`, `HIT_`…) 91 %;
  detection (5: `NOTC` 88 %, `COTN` 36 %) 63 %; scene (2) 8 %; miscellaneous (7: `IDLE`,
  `HELO`, `GREE`) 4 %. Calm clips for a baseline are categories 2 and 7 plus custom topics.
  As a cue the category does not hold up by ear: labelled combat lines were 11 / 15 / 9,
  and pushed ones without a `!` 1 / 2 / 2, so `decideVocalEffort` does not take it.
- **Text.** Lines with `!`: 82 %; without: 8 %. Labelled 17 / 26 / 4 — the cue of
  `shouting`, never enough alone.
- **Actor notes.** `NAM2` follows its `NAM1`; filled on 37 % of the lines. Useful when it
  speaks ("quick shout as you flee"), silent for most barks. A cue next to `!`.
- **Emotion — not needed.** FO4 `TRDA` starts with the FormID of a `KYWD` named
  `AnimFaceArchetype<Emotion>`; `FFFFFFFF` means none (a third of the lines, most combat
  barks among them). `Angry` 35 %, `Afraid` 22 %, `Stern` 18 %, `Neutral` 9 %, `Friendly`
  3 %; labelled angry, afraid and in-pain lines were 2 / 12 / 3 — a raised voice, not a
  shout. Starfield's 12-byte `TRDA` is believed to hold an emotion FormID plus an
  intensity float. If it is ever read, `infoResponseNumbers.ts` already walks `TRDA` for
  the response number — extend that walk, do not add a second one.

Game-specific parts go through `src/games/contract`; shared code must not compare game ids.
`infoResponseNumbers.ts` is close to the 300-line limit — check the count and split first if needed.

### 4. Calibrate, then wire the tag in

**Calibrated 2026-11-27** on the 160 labelled lines of step 1 (counts are shout / raised
voice / calm). A false `[shouting]` on a calm line is worse than a missed shout, so the
rule is tuned for precision.

- Strength is the weaker of the pitch and brightness z-scores. It separates shouts from
  calm lines better than their sum (AUC 0.95 against 0.92): one cue alone is common in calm
  speech.
- `shouting` = strength ≥ 2.0 and a cue in the line (`!` or a shout in the actor note):
  14 / 6 / 0 of 20 labelled lines, 508 of 7,810 in the corpus (62 of Preston's 2,405, 163 of
  the female raider's 620). No calm line among 20 still allows a real rate up to about 15 %.
- `loud` = strength ≥ 2.5 without a cue: 0 / 5 / 1 of 6 labelled, 117 in the corpus. From
  2.0 it was 2 / 8 / 3.
- 14 of the 23 labelled shouts get `shouting`. The nine missed are raider lines with no `!`
  ("Hurry, damn you.") or a strength under 2.0; they stay as flat as they are today.
- Dropped from the first draft: the weighted sum, the combat-topic and emotion inputs
  (step 3 has the counts), and `screaming` — no labelled line tells a scream from a shout.
- Shout against raised voice is the soft edge (AUC 0.78), and the listener says so too. A
  raised voice tagged `[shouting]` is the error to listen for in step 2.

Still to do:

- Persist per-clip features or the decision so synthesis does not re-analyze every clip
  (speaker baselines need all of a speaker's clips; compute once per import).
- Call `applyEffortTag` after `stripVoiceNonSpeechBlocks`, behind a per-game voice setting
  that defaults to off. The tag changes `text`, so it changes `payloadVersion` and marks
  takes stale — make sure only lines that actually get a tag are re-synthesized.
- Tag only the TTS text. Lip-sync text (`remoteFfxanim` strips `[tags]`) and timing must
  not see it.

### 5. Independent fixes, if tags are not enough

- Pick appended speaker clips by closeness in effort to the line clip (features are
  already there), and check whether `scoreReferenceWav` rejects shouted clips.
- Add effort closeness to take ranking next to `ttsSimilarity` (step 2: takes of one line
  spread by 0.7 in strength, and strength agrees with the ear).
- Stop the retry gate from preferring a leaked reference: a take that repeats the English
  clip scores 0.70–0.87 in similarity, above every real take of step 2 (≤ 0.61 over 266
  accepted takes). Four leaks on one line are not enough to set a ceiling — count takes above
  ~0.65 in `voice_synthesis_state` and listen to a sample first. Its own PR.
- In `fish-studio`: per-request sampling so shouted lines can use a wider `top_p`.
- Voice conversion (RVC / Seed-VC) from the original shouted clip for key scenes; LoRA
  retraining with expressive Ukrainian data. Both are heavy — last resort.

## Rules that apply

From `CLAUDE.md` / `CONTRIBUTING.md`: a heuristic change is measured on the real corpus
before it ships; one concern per PR; files stay at or under 300 non-comment lines; tests
next to the source; no writes to production data without an explicit command.
