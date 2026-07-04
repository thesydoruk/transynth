/**
 * Канонічний глосарій Fallout 4 (en → uk) для standalone-промптів.
 *
 * Скорочена копія: лише власні назви, фракції, локації, істоти, цілісні предмети.
 * RACE-морфи, легендарні афікси/OMOD, DIAL-меню та S.P.E.C.I.A.L. — у правилах промпту.
 *
 * Самодостатня копія для довідки та ручного редагування.
 * Ніде не імпортується поза підпапкою standalone/fo4.
 */
export type GlossaryEntry = { term: string; translation: string };

export const FALLOUT4_UK_GLOSSARY: GlossaryEntry[] = [
  {
    term: 'Acadia',
    translation: 'Акадія',
  },
  {
    term: 'Addictol',
    translation: 'Аддиктол',
  },
  {
    term: 'Alien Blaster',
    translation: 'Бластер Чужих',
  },
  {
    term: 'Assault Rifle',
    translation: 'Штурмовий карабін',
  },
  {
    term: 'Assaultron',
    translation: 'Штурмотрон',
  },
  {
    term: 'Atom Cats',
    translation: 'Атомні коти',
  },
  {
    term: 'Atom watch over you',
    translation: 'Атом захистить вас',
  },
  {
    term: 'Behemoth',
    translation: 'Чудовисько',
  },
  {
    term: 'Berry Mentats',
    translation: 'Ягідні ментати',
  },
  {
    term: 'Bloatfly',
    translation: 'Дутень',
  },
  {
    term: 'Bloodbug',
    translation: 'Гнус',
  },
  {
    term: 'Brahmin',
    translation: 'Брамін',
  },
  {
    term: 'Brotherhood of Steel',
    translation: 'Братерство сталі',
  },
  {
    term: 'Buffout',
    translation: 'Баффаут',
  },
  {
    term: 'Bufftats',
    translation: 'Бафф-тати',
  },
  {
    term: 'Bunker Hill',
    translation: 'Банкер-Гілл',
  },
  {
    term: 'Cait',
    translation: 'Кейт',
  },
  {
    term: 'Cambridge',
    translation: 'Кембридж',
  },
  {
    term: 'Caps',
    translation: 'Кришки',
  },
  {
    term: 'Captain Kells',
    translation: 'Капітан Келлс',
  },
  {
    term: 'Children of Atom',
    translation: 'Діти Атома',
  },
  {
    term: 'Codsworth',
    translation: 'Кодсворт',
  },
  {
    term: 'Combat Armor',
    translation: 'Бойова броня',
  },
  {
    term: 'Combat Rifle',
    translation: 'Бойовий карабін',
  },
  {
    term: 'Commonwealth',
    translation: 'Співдружність',
  },
  {
    term: 'Concord',
    translation: 'Конкорд',
  },
  {
    term: 'Courser',
    translation: 'Мисливець',
  },
  {
    term: 'Courser Chip',
    translation: 'Чип мисливця',
  },
  {
    term: 'Covenant',
    translation: 'Альянс',
  },
  {
    term: 'Cryolator',
    translation: 'Кріолятор',
  },
  {
    term: 'Curie',
    translation: 'Кюрі',
  },
  {
    term: 'Danse',
    translation: 'Данс',
  },
  {
    term: 'Deacon',
    translation: 'Дікон',
  },
  {
    term: 'Deathclaw',
    translation: 'Кіготь смерті',
  },
  {
    term: 'Deliverer',
    translation: 'Спаситель',
  },
  {
    term: 'Desdemona',
    translation: 'Дездемона',
  },
  {
    term: 'Diamond City',
    translation: 'Даймонд-сіті',
  },
  {
    term: 'DiMA',
    translation: 'ДіМА',
  },
  {
    term: 'Dirty Water',
    translation: 'Брудна вода',
  },
  {
    term: 'Doctor Amari',
    translation: 'Доктор Амарі',
  },
  {
    term: 'Doctor Li',
    translation: 'Докторка Лі',
  },
  {
    term: 'Dogmeat',
    translation: 'Собака',
  },
  {
    term: 'Earl Sterling',
    translation: 'Ерл Стерлінг',
  },
  {
    term: 'Elder Maxson',
    translation: 'Старійшина Мексон',
  },
  {
    term: 'Enclave',
    translation: 'Анклав',
  },
  {
    term: 'Enclave Soldier',
    translation: 'Солдат Анклаву',
  },
  {
    term: 'EyeBot',
    translation: 'Робооко',
  },
  {
    term: 'Far Harbor',
    translation: 'Фар Гарбор',
  },
  {
    term: 'Far Harbor Children of Atom',
    translation: 'Діти Атома з Фар-Гарбор',
  },
  {
    term: 'Fat Man',
    translation: 'Товстун',
  },
  {
    term: 'Feral Ghoul',
    translation: 'Дикий гуль',
  },
  {
    term: 'Flamer',
    translation: 'Вогнемет',
  },
  {
    term: 'Frag Grenade',
    translation: 'Осколкова граната',
  },
  {
    term: 'Freedom Trail',
    translation: 'Шлях Свободи',
  },
  {
    term: 'Fusion Cell',
    translation: 'Ядерна батарея',
  },
  {
    term: 'Fusion Core',
    translation: 'Ядерний блок',
  },
  {
    term: 'Gamma Gun',
    translation: 'Гамма-пістолет',
  },
  {
    term: 'Gatling Laser',
    translation: 'Гатлінг-лазер',
  },
  {
    term: 'Gauss Rifle',
    translation: 'Карабін Гауса',
  },
  {
    term: 'Gen 1 Synth',
    translation: 'Синт першого покоління',
  },
  {
    term: 'Gen 2 Synth',
    translation: 'Синт другого покоління',
  },
  {
    term: 'Ghoul',
    translation: 'Гуль',
  },
  {
    term: 'Glory to Atom!',
    translation: 'Слава Атому!',
  },
  {
    term: 'Glowing One',
    translation: 'Сяючий',
  },
  {
    term: 'Glowing Sea',
    translation: 'Сяюче море',
  },
  {
    term: 'Goodneighbor',
    translation: 'Добросусідство',
  },
  {
    term: 'Gunner',
    translation: 'стрілець',
  },
  {
    term: 'Gunners',
    translation: 'Стрільці',
  },
  {
    term: 'Gwinnett Brand',
    translation: 'Гвіннетт',
  },
  {
    term: 'Gwinnett Brewery',
    translation: 'Броварня «Гвіннетт»',
  },
  {
    term: 'Hancock',
    translation: 'Генкок',
  },
  {
    term: 'Hazmat Suit',
    translation: 'Захисний комплект',
  },
  {
    term: 'Henry Cooke',
    translation: 'Генрі Кук',
  },
  {
    term: 'High Confessor',
    translation: 'Верховний сповідник',
  },
  {
    term: 'High Confessor Tektus',
    translation: 'Верховний сповідник Тект',
  },
  {
    term: 'Holotape',
    translation: 'Голозапис',
  },
  {
    term: 'Hunting Rifle',
    translation: 'Мисливський карабін',
  },
  {
    term: 'Institute',
    translation: 'Інститут',
  },
  {
    term: 'Jet',
    translation: 'Гвинт',
  },
  {
    term: 'Jun Long',
    translation: 'Цзюнь Лон',
  },
  {
    term: 'Junk Jet',
    translation: 'Хламотрон',
  },
  {
    term: 'Kellogg',
    translation: 'Келлог',
  },
  {
    term: 'Knight-Captain',
    translation: 'Лицар-капітан',
  },
  {
    term: 'Knight-Commander',
    translation: 'Лицар-командор',
  },
  {
    term: 'Knight-Sergeant',
    translation: 'Лицар-сержант',
  },
  {
    term: 'Lancer-Knight',
    translation: 'Пілот-лицар',
  },
  {
    term: 'Laser Gun',
    translation: 'Лазерний карабін',
  },
  {
    term: 'Laser Musket',
    translation: 'Лазерний мушкет',
  },
  {
    term: 'Layer Handle',
    translation: 'Обробник шару',
  },
  {
    term: 'Lexington',
    translation: 'Лексінгтон',
  },
  {
    term: 'Liberty Prime',
    translation: 'Ліберті Прайм',
  },
  {
    term: 'MacCready',
    translation: 'Маккріді',
  },
  {
    term: 'Magnolia',
    translation: 'Магнолія',
  },
  {
    term: 'Mama Murphy',
    translation: 'Матінка Мерфі',
  },
  {
    term: 'Marcy Long',
    translation: 'Марсі Лон',
  },
  {
    term: 'Mass Fusion',
    translation: "Масс ф'южн",
  },
  {
    term: 'Maxson',
    translation: 'Мексон',
  },
  {
    term: 'Med-X',
    translation: 'Мед-Х',
  },
  {
    term: 'Mentats',
    translation: 'Ментати',
  },
  {
    term: 'Metal Armor',
    translation: 'Металева броня',
  },
  {
    term: 'Mini Nuke',
    translation: 'Ядерний мінізаряд',
  },
  {
    term: 'Minigun',
    translation: 'Мініган',
  },
  {
    term: 'Minuteman',
    translation: 'Мінітмен',
  },
  {
    term: 'Minutemen',
    translation: 'Мінітмени',
  },
  {
    term: 'Mirelurk',
    translation: 'Болотник',
  },
  {
    term: 'Mirelurk King',
    translation: 'Король болотників',
  },
  {
    term: 'Mirelurk Queen',
    translation: 'Королева болотників',
  },
  {
    term: 'Missile Launcher',
    translation: 'Гранатомет',
  },
  {
    term: 'Mister Handy',
    translation: 'Містер Помічник',
  },
  {
    term: 'Mole Rat',
    translation: 'Кротощур',
  },
  {
    term: 'Molerat',
    translation: 'Кротощур',
  },
  {
    term: 'Molotov Cocktail',
    translation: 'Коктейль Молотова',
  },
  {
    term: 'Mongrel',
    translation: 'Дикий пес',
  },
  {
    term: 'Mr. Gutsy',
    translation: 'Містер Сміливець',
  },
  {
    term: 'Mr. Handy',
    translation: 'Містер Помічник',
  },
  {
    term: 'Mutant Hound',
    translation: 'Гончак-мутант',
  },
  {
    term: 'Mutfruit',
    translation: 'Мутафрукт',
  },
  {
    term: 'Myrna',
    translation: 'Мирна',
  },
  {
    term: 'Nate',
    translation: 'Нейт',
  },
  {
    term: 'Nick Valentine',
    translation: 'Нік Валентайн',
  },
  {
    term: 'Nora',
    translation: 'Нора',
  },
  {
    term: 'Nuka-Cola',
    translation: 'Ядер-Кола',
  },
  {
    term: 'Nuka-Cola Quantum',
    translation: 'Квантова Ядер-Кола',
  },
  {
    term: 'Nuka-World',
    translation: 'Ядер-Світ',
  },
  {
    term: 'Nuke',
    translation: 'Ядерна бомба',
  },
  {
    term: 'Old Longfellow',
    translation: 'Старий Лонгфелло',
  },
  {
    term: 'Pack Captive',
    translation: 'Бранець Зграї',
  },
  {
    term: 'Paladin Brandis',
    translation: 'Паладин Брендіс',
  },
  {
    term: 'Paladin Danse',
    translation: 'Паладин Данс',
  },
  {
    term: 'Pickman',
    translation: 'Пікман',
  },
  {
    term: 'Pip-Boy',
    translation: 'Піп-бой',
  },
  {
    term: 'Piper',
    translation: 'Пайпер',
  },
  {
    term: 'Plasma Cartridge',
    translation: 'Заряд плазми',
  },
  {
    term: 'Plasma Gun',
    translation: 'Плазмовий карабін',
  },
  {
    term: 'Power Armor',
    translation: 'Силова броня',
  },
  {
    term: 'Preston Garvey',
    translation: 'Престон Гарві',
  },
  {
    term: 'Proctor Ingram',
    translation: 'Прокторка Інграм',
  },
  {
    term: 'Protectron',
    translation: 'Протектрон',
  },
  {
    term: 'Provisioner',
    translation: 'Постачальник',
  },
  {
    term: 'Prydwen',
    translation: 'Придвен',
  },
  {
    term: 'Psycho',
    translation: 'Психо',
  },
  {
    term: 'Purified Water',
    translation: 'Очищена вода',
  },
  {
    term: 'Rad-X',
    translation: 'Рад-Х',
  },
  {
    term: 'RadAway',
    translation: 'Антирадин',
  },
  {
    term: 'Radio Freedom',
    translation: 'Радіо Свобода',
  },
  {
    term: 'Radroach',
    translation: 'Радтарган',
  },
  {
    term: 'rads',
    translation: 'радіація',
  },
  {
    term: 'Radscorpion',
    translation: 'Радскорпіон',
  },
  {
    term: 'Radstag',
    translation: 'Рад-олень',
  },
  {
    term: 'Raider',
    translation: 'Рейдер',
  },
  {
    term: 'Raiders',
    translation: 'Рейдери',
  },
  {
    term: 'Railroad',
    translation: 'Підземка',
  },
  {
    term: 'Razorgrain',
    translation: 'Бритвозлак',
  },
  {
    term: 'Red Death',
    translation: 'Червона смерть',
  },
  {
    term: 'Red Rocket',
    translation: 'Червона ракета',
  },
  {
    term: 'Sanctuary Hills',
    translation: 'Сенкчуарі-Гіллз',
  },
  {
    term: 'Sentry Bot',
    translation: 'Робот-охоронець',
  },
  {
    term: 'Settler',
    translation: 'Поселенець',
  },
  {
    term: 'Shaun',
    translation: 'Шон',
  },
  {
    term: 'Signal Interceptor',
    translation: 'Перехоплювач сигналу',
  },
  {
    term: 'Silver Shroud',
    translation: 'Срібний Плащ',
  },
  {
    term: 'Sister Gwyneth',
    translation: 'Сестра Гвінет',
  },
  {
    term: 'Spectacle Island',
    translation: 'Спектакл-айленд',
  },
  {
    term: 'Star Paladin',
    translation: 'Зоряний паладин',
  },
  {
    term: 'Stealth Boy',
    translation: 'Стелс-бой',
  },
  {
    term: 'Stimpack',
    translation: 'Стимулятор',
  },
  {
    term: 'Stimpak',
    translation: 'Стимулятор',
  },
  {
    term: 'Stingwing',
    translation: 'Жалокрил',
  },
  {
    term: 'Sturges',
    translation: 'Стурджес',
  },
  {
    term: 'Super Mutant',
    translation: 'Супермутант',
  },
  {
    term: 'Super Mutants',
    translation: 'Супермутанти',
  },
  {
    term: 'Synth',
    translation: 'Синт',
  },
  {
    term: 'Synth Refugee',
    translation: 'Синт-втікач',
  },
  {
    term: 'Tarberry',
    translation: 'Смоляниця',
  },
  {
    term: 'The Brotherhood',
    translation: 'Братерство',
  },
  {
    term: 'The Combat Zone',
    translation: 'Бойова зона',
  },
  {
    term: 'The Commonwealth',
    translation: 'Співдружність',
  },
  {
    term: 'The Fog',
    translation: 'Туман',
  },
  {
    term: 'The Forged',
    translation: 'Ковані',
  },
  {
    term: 'The Institute',
    translation: 'Інститут',
  },
  {
    term: 'The Mechanist',
    translation: 'Механіст',
  },
  {
    term: 'The Memory Den',
    translation: 'Лігво спогадів',
  },
  {
    term: 'The Pack',
    translation: 'Зграя',
  },
  {
    term: 'The Railroad',
    translation: 'Підземка',
  },
  {
    term: 'The Silver Shroud',
    translation: 'Срібний Плащ',
  },
  {
    term: 'The Third Rail',
    translation: 'Третя рейка',
  },
  {
    term: 'Tinker Tom',
    translation: 'Технік Том',
  },
  {
    term: 'Trashcan Carla',
    translation: 'Карла Урна',
  },
  {
    term: 'Triggerman',
    translation: 'Гангстер',
  },
  {
    term: 'Triggermen',
    translation: 'Гангстери',
  },
  {
    term: 'Turret',
    translation: 'Турель',
  },
  {
    term: 'Utility Jumpsuit',
    translation: 'Утилітарний комбінезон',
  },
  {
    term: 'Vault',
    translation: 'Сховище',
  },
  {
    term: 'Vault 111',
    translation: 'Сховище 111',
  },
  {
    term: 'Vault-Tec',
    translation: 'Волт-Тек',
  },
  {
    term: 'Virgil',
    translation: 'Верджіл',
  },
  {
    term: 'Wasteland Workshop',
    translation: 'Майстерня пустки',
  },
  {
    term: 'Wastelander',
    translation: 'Мешканець Пустки',
  },
  {
    term: 'Workshop',
    translation: 'Майстерня',
  },
  {
    term: 'X6-88',
    translation: 'X6-88',
  },
  {
    term: 'Yao Guai',
    translation: 'Яо-гай',
  },
];
