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

- `src/voice/vocalEffort/features.ts` — per-clip pitch (median, p90, in semitones) and
  high-band emphasis. Both ignore level on purpose: shipped voice files are normalized.
- `src/voice/vocalEffort/baseline.ts` — per-speaker median/MAD baseline and z-scores.
- `src/voice/vocalEffort/decide.ts` — weighted sum of hints → `loud` / `shouting` /
  `screaming` / none, plus `applyEffortTag` (not called anywhere yet).
- `scripts/scanVocalEffort.ts` (`npm run voice:scan-effort -- <dir>`) — ranks a folder of
  decoded 16-bit WAVs laid out as `<speaker>/<clip>.wav`, prints TSV. Acoustic hint only.
- Tests: `src/voice/vocalEffort/__tests__/vocalEffort.test.ts`.

**Verified:** lint, `tsc`, Prettier, the 16 new tests, one end-to-end run of the script.
**Not verified:** anything on real voices. Tests and the script run used synthetic harmonic
tones. Every weight and threshold in `decide.ts` is a first guess.

## Next steps

Do them in order; each one decides whether the next is worth doing.

### 1. Check that the acoustic features separate shouts on real clips

- Decode the original clips of two or three FO4 voice types (one male, one female, one with
  many combat barks) to WAV and run `npm run voice:scan-effort`.
- Listen to the top ~20, the bottom ~20 and the rows around scores 1.2 and 2.0.
- Pass: the top is mostly shouted lines and calm lines are rare above 2.0.
- If it fails, look at which column lies (`zF0`, `zBright`, `voiced`). Known weak spots:
  the brightness measure is a first-difference energy ratio, not a real spectral tilt, and
  may react to sibilants or radio/helmet filters; pitch may octave-jump on creaky voices;
  robot and creature voice types probably need excluding.

### 2. A/B the model before building more (in `fish-studio`)

Ten clearly shouted lines, same references, four variants: with and without `[shouting]`,
with and without the LoRA. This tells whether tags work at all on the current stack and
whether the LoRA is what mutes them. If tags do nothing even without the LoRA, stop here
and go to step 5 instead.

Also confirm the server passes `[tag]` text through to the model untouched —
`fish_studio/timing.py` strips `[...]` for timing, which is fine, but check the synthesis
path does not.

### 3. Read the plugin-side hints

`decideVocalEffort` already accepts them; nothing parses them yet. Subrecord layouts below
are from memory — confirm each in xEdit before coding against it.

- **Combat topics.** `DIAL` carries a subtype / category; combat barks (attack, hit, flee,
  taunt, alert-to-combat, death) sit in the combat category. Feed `combatBark`.
- **Emotion.** FO4 `TRDA` (20 bytes) is believed to start with an emotion FormID (a facial
  animation keyword); Starfield's 12-byte `TRDA` has emotion FormID plus an intensity
  float. `infoResponseNumbers.ts` already walks `TRDA` for the response number — extend
  that walk, do not add a second one. Map keywords to `anger` / `fear` / `pain` / `other`.
- **Actor notes.** `NAM2` on INFO responses holds voice direction ("shouting over
  gunfire"). Check how often it is filled in `Fallout4.esm` before relying on it.

Game-specific parts go through `src/games/contract`; shared code must not compare game ids.
`infoResponseNumbers.ts` is already past 300 lines — split before adding to it.

### 4. Calibrate, then wire the tag in

- Hand-label ~100–200 lines (shout / not) across several speakers, tune weights and the
  three thresholds in `decide.ts`, record precision at the chosen threshold. A false
  `[shouting]` on a calm line is worse than a missed shout, so tune for precision.
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
- Add effort closeness to take ranking next to `ttsSimilarity`.
- In `fish-studio`: per-request sampling so shouted lines can use a wider `top_p`.
- Voice conversion (RVC / Seed-VC) from the original shouted clip for key scenes; LoRA
  retraining with expressive Ukrainian data. Both are heavy — last resort.

## Rules that apply

From `CLAUDE.md` / `CONTRIBUTING.md`: a heuristic change is measured on the real corpus
before it ships; one concern per PR; files stay at or under 300 non-comment lines; tests
next to the source; no writes to production data without an explicit command.
