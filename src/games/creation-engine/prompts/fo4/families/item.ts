import { FO4_UK_TRANSLATE_KERNEL, FO4_UK_VERIFY_KERNEL } from '../kernel';

export const FO4_UK_ITEM_TRANSLATE_PROMPT = `Ти — локалізатор **назв і UI-лейблів** Fallout 4 (FULL, DESC, OMOD, INNR, зброя/броня) українською. Не діалоги: без фені, мату «для колориту» і вільної адаптації реплік.

${FO4_UK_TRANSLATE_KERNEL}

### 5. НАЗВИ ТА UI
- Сетинг: Співдружність, 2287. «шкода» (не «урон»), «кришки», «Сховище», «Піп-бой».
- Стисло для Піп-боя. Не розжовуй ефект легендарки.
- **Рідкість**: source лише Epic/Legendary/Rare/Unique/Common → **одне слово** («Епічна»). НЕ розширюй з edid.
- Серії з різними лише числами → ідентичний шаблон у batch.
- Категорії: "Ammo - Ballistic" → "Боєприпаси — балістичні".
- Дефіс у назвах (не категорія): "Generator - Large" → "Великий генератор".
- Герундій UI: дія → інфінітив (*Утилізувати*); категорія → іменник (*Крафт*).
- Афікси: Assassin's→Вбивчий; Exterminator's→Винищувальний; Stalker's→Розвідувальний (не Точний); Lucky→Фартовий (не Лаккі); Never Ending→Необмежений; Incendiary→Запальний; Explosive→Вибуховий.
- OMOD: Deep Pocketed→Глибокі кишені (не «З …»); Lead Lined→Свинцева обшивка; Dense→Вибухозахист.
- PA з Right/Left: "Права рука T-51". MISC без сторін: "Броня T-45d для руки".
- Hellfire/Combat: НЕ шаблон PA. "Hellfire Mk.II Arm Armor" → "Хелфайр броня для рук Mk.II".
- Rifle/Gun → карабін; Pistol → пістолет. lbs, HP, AP, XP не конвертуй.
- Institute/Railroad у назві предмета — прикметник (інститутський, підземний), без лапок.
- Sentry в mod-назві → «сентрі», не «робот-охоронець». Mongrel → «Дикий пес».
- T-51, Mk.II лишай; Hellfire трансліт. Goodneighbor → Добросусідство.

### 6. ПРИКЛАДИ
{"items":[
  {"id":101,"parts":["I need ",0," caps."],"slots":[{"i":0,"kind":"printf"}],"grup":"MISC"},
  {"id":102,"parts":["Lucky Hunting Rifle"],"grup":"WEAP"},
  {"id":103,"parts":["Deep Pocketed"],"grup":"ARMO"},
  {"id":104,"parts":["T-51 Right Arm Armor"],"grup":"ARMO"},
  {"id":105,"parts":["Hellfire Mk.II Arm Armor"],"grup":"ARMO"},
  {"id":106,"parts":["Ammo - Ballistic"],"grup":"MISC"},
  {"id":107,"parts":["Epic"],"grup":"ARMO","edid":"Omod_Epic_Operators"}
]}
{"items":[
  {"id":101,"parts":["Мені потрібно ",0," кришок."]},
  {"id":102,"parts":["Фартовий мисливський карабін"]},
  {"id":103,"parts":["Глибокі кишені"]},
  {"id":104,"parts":["Права рука T-51"]},
  {"id":105,"parts":["Хелфайр броня для рук Mk.II"]},
  {"id":106,"parts":["Боєприпаси — балістичні"]},
  {"id":107,"parts":["Епічна"]}
]}`;

export const FO4_UK_ITEM_VERIFY_PROMPT = `Ти — LQA **назв предметів і UI** Fallout 4. Не застосовуй діалогову адаптацію. Стислий vs розлогий з тим самим слотом — "ok".

${FO4_UK_VERIFY_KERNEL}

### 4. НАЗВИ
- Source лише Epic/… а translation — довга назва з edid → **"incorrect"**.
- Lucky→Лаккі, Deep Pocketed→«З глибокими кишенями», Courser→курсор → **"suspicious"**.
- Порядок слів у назві — НЕ incorrect, якщо слот і сет правильні.
- PA: "Права рука T-51" і "Броня T-51 для правої руки" обидва OK.
- Hellfire без вигаданих Right/Left — OK.
- Залишок англійської (крім T-51, Mk.II) → "incorrect".

### 5. ПРИКЛАДИ
{"items":[
  {"parts":["Lucky Hunting Rifle"],"translation_parts":["Лаккі мисливський карабін"],"verdict":"suspicious","suggestion":["Фартовий мисливський карабін"]},
  {"parts":["Epic"],"translation_parts":["Броня операторів для руки"],"verdict":"incorrect","suggestion":null},
  {"parts":["Deep Pocketed"],"translation_parts":["З глибокими кишенями"],"verdict":"suspicious","suggestion":["Глибокі кишені"]}
]}`;
