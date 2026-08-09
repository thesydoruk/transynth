# Ukrainian voice mapping proposal (670 characters)

Source: ai-pipeline `dialog_speakers`. **Not written to DB yet.**

## Rules

- 1 character (voice folder) → 1 unique library voice
- Global across mods (no per-mod override)
- 5 opentts studio voices hand-assigned to flagship companions
- Remaining human/synth folders → distinct Common Voice UA clips (CC0)
- **Robots omitted from this proposal only** — no link written; they stay on the default pipeline until linked manually

## Summary

- Mapped characters: **670**
- Skipped robots: **35** (no UK library link)
- Gender (mapped): male 414, female 256, unknown 0

## Skipped robots (unchanged pipeline)

| Character                          | Display                              | Lines |
| ---------------------------------- | ------------------------------------ | ----: |
| `RobotMrHandy`                     | Robot Mr Handy                       |  2977 |
| `DLC01RobotCompanionFemaleDefault` | DLC 01Robot Companion Female Default |  1205 |
| `RobotProtectron`                  | Robot Protectron                     |   262 |
| `DLC01RobotRobobrain`              | Jezebel's Voice                      |   235 |
| `RobotPAM`                         | Robot PAM                            |   228 |
| `RobotIronsides`                   | Robot Ironsides                      |   200 |
| `RobotMrGutsy`                     | Robot Mr Gutsy                       |   173 |
| `RobotAssaultron`                  | Robot Assaultron                     |   172 |
| `RobotWhitechapelCharlie`          | Robot Whitechapel Charlie            |   108 |
| `DLC04RobotProtectronCowboy`       | DLC 04Robot Protectron Cowboy        |   100 |
| `RobotSentryBot`                   | Robot Sentry Bot                     |    93 |
| `RobotSupervisorWhite`             | Robot Supervisor White               |    82 |
| `DLC03RobotPearl`                  | DLC 03Robot Pearl                    |    78 |
| `RobotLibertyPrime`                | Robot Liberty Prime                  |    72 |
| `RobotMsNanny`                     | Robot Ms Nanny                       |    57 |
| `RobotMolly`                       | Robot Molly                          |    50 |
| `RobotSupervisorGreene`            | Robot Supervisor Greene              |    45 |
| `RobotMS11Bosun`                   | Robot MS 11Bosun                     |    43 |
| `RobotNavigator`                   | Robot Navigator                      |    40 |
| `RobotSupervisorBrown`             | Robot Supervisor Brown               |    38 |
| `DLC04RobotNukatron`               | DLC 04Robot Nukatron                 |    35 |
| `RobotDeezer`                      | Robot Deezer                         |    34 |
| `DLC01RobotCompanionBleepA`        | DLC 01Robot Companion Bleep A        |    33 |
| `DLC01RobotCompanionBleepB`        | DLC 01Robot Companion Bleep B        |    33 |
| `DLC01RobotCompanionBleepC`        | DLC 01Robot Companion Bleep C        |    33 |
| `DLC04RobotNira`                   | DLC 04Robot Nira                     |    32 |
| `DLC01MechanistEyebot`             | The Mechanist                        |    28 |
| `RobotLookout`                     | Robot Lookout                        |    17 |
| `RobotFirstMate`                   | Robot First Mate                     |    11 |
| `RobotDrFeelgood`                  | Robot Dr Feelgood                    |    10 |
| `RobotEyebot`                      | Robot Eyebot                         |     9 |
| `DLC03V118_RobotGeneric`           | Robot Generic                        |     5 |
| `RobotArcJetComputer`              | Arcjet Mainframe                     |     5 |
| `RobotGraygardenWorker`            | Robot Graygarden Worker              |     5 |
| `RobotTakahashi`                   | Robot Takahashi                      |     1 |

## Studio opentts (hand-picked)

| Character           | Display        | Voice    | Reason                                                                                                                            |
| ------------------- | -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `NPCFCait`          | Cait           | Kateryna | studio Kateryna (Apache-2.0); Cait — remaining female studio voice for a major companion; 1768 lines / 3 mods                     |
| `NPCFCurie`         | Curie          | Tetiana  | studio Tetiana (Apache-2.0); Curie — clear, slightly formal female studio voice fits synthetic/academic tone; 1599 lines / 2 mods |
| `NPCFPiper`         | Piper          | Lada     | studio Lada (Apache-2.0); flagship female companion Piper — warm readable female studio voice; 1886 lines / 2 mods                |
| `NPCMNickValentine` | Nick Valentine | Mykyta   | studio Mykyta (Apache-2.0); Nick Valentine — high-line detective companion, distinct male studio timbre; 2334 lines / 3 mods      |
| `NPCMPrestonGarvey` | Preston Garvey | Oleksa   | studio Oleksa (Apache-2.0); Preston Garvey — second male studio slot for a core Minutemen companion; 2326 lines / 4 mods          |

## Next highest CV assignments (sample)

| Character                   | Display                       | Gender | Lines | Voice slot   | Reason                                                                                                         |
| --------------------------- | ----------------------------- | ------ | ----: | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `PlayerVoiceFemale01`       | Player                        | female | 17635 | `cv:slot-1`  | Common Voice UA (CC0), unique slot #1; character female, no unused matching studio voice; 17635 lines / 7 mods |
| `NPCMPaladinDanse`          | Paladin Danse                 | male   |  2088 | `cv:slot-2`  | Common Voice UA (CC0), unique slot #2; character male, no unused matching studio voice; 2088 lines / 2 mods    |
| `FemaleBoston`              | Female Boston                 | female |  1950 | `cv:slot-3`  | Common Voice UA (CC0), unique slot #3; character female, no unused matching studio voice; 1950 lines / 3 mods  |
| `NPCMHancock`               | Hancock                       | male   |  1815 | `cv:slot-4`  | Common Voice UA (CC0), unique slot #4; character male, no unused matching studio voice; 1815 lines / 2 mods    |
| `NPCMDeacon`                | Deacon                        | male   |  1783 | `cv:slot-5`  | Common Voice UA (CC0), unique slot #5; character male, no unused matching studio voice; 1783 lines / 2 mods    |
| `NPCMMacCready`             | Mac Cready                    | male   |  1641 | `cv:slot-6`  | Common Voice UA (CC0), unique slot #6; character male, no unused matching studio voice; 1641 lines / 2 mods    |
| `NPCMX6-88`                 | X 6-88                        | male   |  1528 | `cv:slot-7`  | Common Voice UA (CC0), unique slot #7; character male, no unused matching studio voice; 1528 lines / 2 mods    |
| `NPCMStrong`                | Strong                        | male   |  1256 | `cv:slot-8`  | Common Voice UA (CC0), unique slot #8; character male, no unused matching studio voice; 1256 lines / 2 mods    |
| `DLC04NPCMGage`             | Porter Gage                   | male   |  1163 | `cv:slot-9`  | Common Voice UA (CC0), unique slot #9; character male, no unused matching studio voice; 1163 lines / 1 mods    |
| `NPCMTravisMiles`           | Travis Miles                  | male   |  1133 | `cv:slot-10` | Common Voice UA (CC0), unique slot #10; character male, no unused matching studio voice; 1133 lines / 2 mods   |
| `DLC03MaleOldLongfellow`    | DLC 03Male Old Longfellow     | male   |   971 | `cv:slot-11` | Common Voice UA (CC0), unique slot #11; character male, no unused matching studio voice; 971 lines / 1 mods    |
| `FemaleEvenToned`           | Mercenary                     | female |   913 | `cv:slot-12` | Common Voice UA (CC0), unique slot #12; character female, no unused matching studio voice; 913 lines / 5 mods  |
| `BoSFemale01`               | Scribe Naceri                 | female |   895 | `cv:slot-13` | Common Voice UA (CC0), unique slot #13; character female, no unused matching studio voice; 895 lines / 1 mods  |
| `NPCFDesdemona`             | Desdemona                     | female |   789 | `cv:slot-14` | Common Voice UA (CC0), unique slot #14; character female, no unused matching studio voice; 789 lines / 1 mods  |
| `MaleEvenToned`             | Subject 12                    | male   |   764 | `cv:slot-15` | Common Voice UA (CC0), unique slot #15; character male, no unused matching studio voice; 764 lines / 3 mods    |
| `NPCMShaun60`               | Shaun 60                      | male   |   731 | `cv:slot-16` | Common Voice UA (CC0), unique slot #16; character male, no unused matching studio voice; 731 lines / 1 mods    |
| `ChildrenOfAtomFemale01`    | Children Of Atom Female 01    | female |   564 | `cv:slot-17` | Common Voice UA (CC0), unique slot #17; character female, no unused matching studio voice; 564 lines / 2 mods  |
| `NPCMLancerCaptainKells`    | Lancer Captain Kells          | male   |   534 | `cv:slot-18` | Common Voice UA (CC0), unique slot #18; character male, no unused matching studio voice; 534 lines / 2 mods    |
| `RaiderFemale01`            | Tessa                         | female |   530 | `cv:slot-19` | Common Voice UA (CC0), unique slot #19; character female, no unused matching studio voice; 530 lines / 2 mods  |
| `NPCFProctorIngram`         | Proctor Ingram                | female |   483 | `cv:slot-20` | Common Voice UA (CC0), unique slot #20; character female, no unused matching studio voice; 483 lines / 1 mods  |
| `NPCMElderMaxson`           | Elder Maxson                  | male   |   481 | `cv:slot-21` | Common Voice UA (CC0), unique slot #21; character male, no unused matching studio voice; 481 lines / 1 mods    |
| `MaleBoston`                | Soup Can Harry                | male   |   450 | `cv:slot-22` | Common Voice UA (CC0), unique slot #22; character male, no unused matching studio voice; 450 lines / 2 mods    |
| `DP_RoxyVoice`              | Roxy                          | female |   440 | `cv:slot-23` | Common Voice UA (CC0), unique slot #23; character female, no unused matching studio voice; 440 lines / 1 mods  |
| `FemaleRough`               | Settler                       | female |   439 | `cv:slot-24` | Common Voice UA (CC0), unique slot #24; character female, no unused matching studio voice; 439 lines / 3 mods  |
| `NPCMJackCabot`             | Jack Cabot                    | male   |   435 | `cv:slot-25` | Common Voice UA (CC0), unique slot #25; character male, no unused matching studio voice; 435 lines / 1 mods    |
| `MaleGhoulCombatant01`      | Male Ghoul Combatant 01       | male   |   421 | `cv:slot-26` | Common Voice UA (CC0), unique slot #26; character male, no unused matching studio voice; 421 lines / 1 mods    |
| `DLC03MaleDiMA`             | DLC 03Male Di MA              | male   |   391 | `cv:slot-27` | Common Voice UA (CC0), unique slot #27; character male, no unused matching studio voice; 391 lines / 1 mods    |
| `DLC04NPCMShank`            | DLC 04NPCMShank               | male   |   380 | `cv:slot-28` | Common Voice UA (CC0), unique slot #28; character male, no unused matching studio voice; 380 lines / 1 mods    |
| `DP_StellaVoice`            | Stella                        | female |   367 | `cv:slot-29` | Common Voice UA (CC0), unique slot #29; character female, no unused matching studio voice; 367 lines / 1 mods  |
| `CompanionPeterChildVoice`  | Peter                         | male   |   365 | `cv:slot-30` | Common Voice UA (CC0), unique slot #30; character male, no unused matching studio voice; 365 lines / 1 mods    |
| `DLC04GangPackFemale01`     | Raider Man                    | female |   365 | `cv:slot-31` | Common Voice UA (CC0), unique slot #31; character female, no unused matching studio voice; 365 lines / 1 mods  |
| `DP_TinaDeLucaVoice`        | Tina De Luca                  | female |   332 | `cv:slot-32` | Common Voice UA (CC0), unique slot #32; character female, no unused matching studio voice; 332 lines / 1 mods  |
| `DLC06MaleClem`             | DLC 06Male Clem               | male   |   321 | `cv:slot-33` | Common Voice UA (CC0), unique slot #33; character male, no unused matching studio voice; 321 lines / 1 mods    |
| `DLC04GangDiscipleFemale01` | DLC 04Gang Disciple Female 01 | female |   318 | `cv:slot-34` | Common Voice UA (CC0), unique slot #34; character female, no unused matching studio voice; 318 lines / 1 mods  |
| `DLC04GangOperatorFemale01` | Raider Woman                  | female |   311 | `cv:slot-35` | Common Voice UA (CC0), unique slot #35; character female, no unused matching studio voice; 311 lines / 1 mods  |
| `MaleRough`                 | Male Rough                    | male   |   306 | `cv:slot-36` | Common Voice UA (CC0), unique slot #36; character male, no unused matching studio voice; 306 lines / 3 mods    |
| `NPCMTinkerTom`             | Tinker Tom                    | male   |   304 | `cv:slot-37` | Common Voice UA (CC0), unique slot #37; character male, no unused matching studio voice; 304 lines / 1 mods    |
| `NPCFScribeHaylen`          | Scribe Haylen                 | female |   296 | `cv:slot-38` | Common Voice UA (CC0), unique slot #38; character female, no unused matching studio voice; 296 lines / 1 mods  |
| `DP_HarleyQuinnVoice`       | Harley Quinn                  | female |   287 | `cv:slot-39` | Common Voice UA (CC0), unique slot #39; character female, no unused matching studio voice; 287 lines / 1 mods  |
| `DLC06FemaleOverseer`       | Overseer Barstow              | female |   284 | `cv:slot-40` | Common Voice UA (CC0), unique slot #40; character female, no unused matching studio voice; 284 lines / 1 mods  |

Full JSON: `scripts/tmpUkVoiceMappingProposal.json`
