/**
 * Canonical The Witcher 3 English → Ukrainian glossary.
 *
 * The forms are those of the game's own Ukrainian localization
 * (`ua.w3strings` of the 2026 Remastered release), checked term by term
 * against the en→ua pairs in that table on 2026-10-10: each translation below
 * is the form the official text uses for the term standing alone, with the
 * official capitalization (the Wild Hunt is «Дикий гін», gwent is «гвинт» in
 * running text). Where the game departs from the Ukrainian book editions
 * (Кер-Морен, Новіґрад, Весемір, Реґіс) the game wins, because the player
 * reads both side by side. It is a starting set, not a closed list: the
 * database glossary seeded from it is what translators extend.
 *
 * Loaded by glossary seeding and translation prompts.
 */
import type { GlossaryEntry } from '../../../resources/glossary/types';

export const WITCHER3_UK_GLOSSARY: GlossaryEntry[] = [
  // Characters
  { term: 'Geralt of Rivia', translation: 'Ґеральт із Ривії' },
  { term: 'Geralt', translation: 'Ґеральт' },
  { term: 'White Wolf', translation: 'Білий Вовк' },
  { term: 'Yennefer of Vengerberg', translation: 'Єннефер з Венґерберґа' },
  { term: 'Yennefer', translation: 'Єннефер' },
  { term: 'Triss Merigold', translation: 'Трісс Меріґольд' },
  { term: 'Cirilla', translation: 'Цірілла' },
  { term: 'Ciri', translation: 'Цірі' },
  { term: 'Dandelion', translation: 'Любисток' },
  { term: 'Zoltan Chivay', translation: 'Золтан Чивай' },
  { term: 'Vesemir', translation: 'Весемір' },
  { term: 'Lambert', translation: 'Ламберт' },
  { term: 'Eskel', translation: 'Ескель' },
  { term: 'Emhyr var Emreis', translation: 'Емгир вар Емрейс' },
  { term: 'Radovid', translation: 'Радовід' },
  { term: 'Sigismund Dijkstra', translation: 'Сигізмунд Дійкстра' },
  { term: 'Philippa Eilhart', translation: 'Філіппа Ейльгарт' },
  { term: 'Keira Metz', translation: 'Кейра Мец' },
  { term: 'Eredin', translation: 'Ередін' },
  { term: "Avallac'h", translation: 'Аваллак’х' },
  { term: 'Bloody Baron', translation: 'Кривавий Барон' },
  { term: 'Ladies of the Wood', translation: 'Господарки Лісу' },
  { term: "Gaunter O'Dimm", translation: 'Ґюнтер О’Дім' },
  { term: 'Olgierd von Everec', translation: 'Ольґерд фон Еверек' },
  { term: 'Regis', translation: 'Реґіс' },
  { term: 'Anna Henrietta', translation: 'Анна-Генрієтта' },
  { term: 'Roach', translation: 'Плітка' },

  // Places
  { term: 'Kaer Morhen', translation: 'Кер-Морен' },
  { term: 'White Orchard', translation: 'Білий Сад' },
  { term: 'Velen', translation: 'Велен' },
  { term: "No Man's Land", translation: 'Нічия Земля' },
  { term: 'Novigrad', translation: 'Новіґрад' },
  { term: 'Oxenfurt', translation: 'Оксенфурт' },
  { term: 'Skellige', translation: 'Скелліґе' },
  { term: 'Vizima', translation: 'Визіма' },
  { term: 'Toussaint', translation: 'Туссен' },
  { term: 'Beauclair', translation: 'Боклер' },
  { term: 'Nilfgaard', translation: 'Нільфґаард' },
  { term: 'Redania', translation: 'Реданія' },
  { term: 'Temeria', translation: 'Темерія' },

  // Factions and lore
  { term: 'Wild Hunt', translation: 'Дикий гін' },
  { term: 'Lodge of Sorceresses', translation: 'Ложа чародійок' },
  { term: 'Elder Blood', translation: 'старша кров' },
  { term: 'witcher', translation: 'відьмак' },
  { term: 'Aard', translation: 'Аард' },
  { term: 'Igni', translation: 'Іґні' },
  { term: 'Quen', translation: 'Квен' },
  { term: 'Yrden', translation: 'Ірден' },
  { term: 'Axii', translation: 'Аксі' },
  { term: 'Gwent', translation: 'Гвинт' },

  // Expansions
  { term: 'Hearts of Stone', translation: 'Серця з каменю' },
  { term: 'Blood and Wine', translation: 'Кров і вино' },
];
