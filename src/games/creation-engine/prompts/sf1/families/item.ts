import { promptJsonItems } from '../../../../../llm/prompts/promptJsonFormat';
import { SF1_UK_TRANSLATE_KERNEL, SF1_UK_VERIFY_KERNEL } from '../kernel';

/**
 * Interaction prompts and buttons: one rendering each, the same in every
 * record that shows it.
 */
export const SF1_UK_INTERACTION_VERBS: ReadonlyArray<readonly [string, string]> = [
  ['Take', 'Взяти'],
  ['Take All', 'Взяти все'],
  ['Pick Up', 'Підняти'],
  ['Open', 'Відкрити'],
  ['Close', 'Закрити'],
  ['Use', 'Використати'],
  ['Activate', 'Активувати'],
  ['Enable', 'Увімкнути'],
  ['Disable', 'Вимкнути'],
  ['Examine', 'Оглянути'],
  ['Inspect', 'Оглянути'],
  ['Search', 'Обшукати'],
  ['Loot', 'Обшукати'],
  ['Harvest', 'Зібрати'],
  ['Collect', 'Зібрати'],
  ['Assemble', 'Зібрати'],
  ['Collect Tissue Sample', 'Взяти зразок тканини'],
  ['Read', 'Читати'],
  ['Read Plaque', 'Прочитати табличку'],
  ['Talk', 'Поговорити'],
  ['Touch', 'Торкнутися'],
  ['Knock', 'Постукати'],
  ['Remove', 'Прибрати'],
  ['Place', 'Покласти'],
  ['Dig', 'Копати'],
  ['Sit', 'Сісти'],
  ['Sleep', 'Спати'],
  ['Wait', 'Чекати'],
  ['Enter', 'Увійти'],
  ['Exit', 'Вийти'],
  ['Leave', 'Піти'],
  ['Disengage', "Від'єднатися"],
  ['Buy', 'Купити'],
  ['Sell', 'Продати'],
  ['Steal', 'Вкрасти'],
  ['Pickpocket', 'Обікрасти'],
  ['Unlock', 'Відімкнути'],
  ['Hack', 'Зламати'],
  ['Repair', 'Полагодити'],
  ['Craft', 'Створити'],
  ['Research', 'Дослідити'],
  ['Build', 'Збудувати'],
  ['Modify', 'Змінити'],
  ['Calibrate', 'Калібрувати'],
  ['Equip', 'Екіпірувати'],
  ['Unequip', 'Зняти'],
  ['Drop', 'Викинути'],
  ['Scan', 'Сканувати'],
  ['Transfer Data', 'Передати дані'],
  ['Download Data', 'Завантажити дані'],
  ['Board', 'Піднятися на борт'],
  ['Dock', 'Стикуватися'],
  ['Undock', 'Відстикуватися'],
  ['Hail', "Вийти на зв'язок"],
  ['Land', 'Сісти'],
  ['Take Off', 'Злетіти'],
  ['Travel', 'Вирушити'],
  ['Fast Travel', 'Швидка подорож'],
  ['Grav Jump', 'Грав-стрибок'],
  ['Accept', 'Прийняти'],
  ['Confirm', 'Підтвердити'],
  ['Cancel', 'Скасувати'],
  ['Continue', 'Продовжити'],
  ['Resume', 'Продовжити'],
  ['Back', 'Назад'],
  ['Yes', 'Так'],
  ['No', 'Ні'],
];

const interactionVerbs = SF1_UK_INTERACTION_VERBS.map(([en, uk]) => `${en} → ${uk}`).join('; ');

export const SF1_UK_ITEM_TRANSLATE_PROMPT = `Ти — локалізатор **назв, описів та інтерфейсу** Starfield (FULL, DESC: зброя, скафандри, модулі корабля, ресурси, планети, навички, NPC, кнопки й підписи) українською. Не діалог: точний термін канону, один шаблон на серію, без стилістики й вільної адаптації.

${SF1_UK_TRANSLATE_KERNEL}

### 5. НАЗВИ ТА ІНТЕРФЕЙС
- **Один шаблон на серію**: якість і модифікація — прикметник за родом іменника ("Удосконалена гвинтівка", "Калібрований скафандр"); рівні модів (Standard, Upgraded) — однаково в усій серії; назва з моделлю — в одному порядку слів у всій серії, як у glossary чи сусідніх рядках.
- Бренди й корпорації — кирилицею, повною транслітерацією, з великої, без лапок у назві запису (Laredo Firearms → Ларедо Фаєрармз); заклад — родове слово + назва (Зореверф "Деймос").
- Ресурси — стандартні назви елементів і сполук (Iron → Залізо, Helium-3 → Гелій-3).
- Планети й зорі: змінюється лише назва зорі — усталена українська для реального каталогу (Alpha Centauri → Альфа Центавра, Tau Ceti → Тау Кита), транслітерація для вигаданих; римська цифра й літера супутника — як є (Bannoc IV → Баннок IV, Carinae III-a → Каріни III-a).
- Ім'я NPC (NPC_ FULL): звання чи посада з великої першої, форма посади — за статтю персонажа ("Командер Кібве Іканде", "Охоронниця Рюдзін", "Космоброд").
- Назви й описи навичок, рис і станів не маркують стать героя.
- Кнопки й підписи інтерфейсу: довжина близька до source; КАПС лишається капсом.
- Дія на підказці взаємодії чи кнопці — інфінітив доконаного виду, тривала — недоконаного: ${interactionVerbs}.
- Класи корабельної зброї: BAL → БАЛ, LAS → ЛАЗ, PAR → ПУЧ, MSL → РАК, EM → ЕМ. XP → ОД.
- Службовий рядок, якого гравець не бачить (Fallback, Quick Test Cell, Debug…, Test…, Text Do Not Use, *Placeholder*, [BE - …]), лиши як є.

### 6. ПРИКЛАДИ
Вхід:
${promptJsonItems([
  { id: 301, parts: ['Advanced Rifle'], grup: 'WEAP' },
  { id: 302, parts: ['Advanced Shotgun'], grup: 'WEAP' },
  { id: 303, parts: ['UC Security Spacesuit'], grup: 'ARMO' },
  { id: 304, parts: ['Deals ', 0, ' damage.'], slots: [{ i: 0, kind: 'tag' }], grup: 'PERK' },
  { id: 305, parts: ['Grav Drive'], grup: 'GBFM' },
  { id: 306, parts: ['Take All'], grup: 'GMST' },
])}
Вихід:
${promptJsonItems([
  { id: 301, parts: ['Удосконалена гвинтівка'] },
  { id: 302, parts: ['Удосконалений дробовик'] },
  { id: 303, parts: ['Скафандр служби безпеки ОК'] },
  { id: 304, parts: ['Завдає ', 0, ' шкоди.'] },
  { id: 305, parts: ['Грав-рушій'] },
  { id: 306, parts: ['Взяти все'] },
])}`;

export const SF1_UK_ITEM_VERIFY_PROMPT = `Ти — LQA **назв, описів та інтерфейсу** Starfield. Діалогової адаптації не застосовуй; стислий і розлогий варіант з тим самим змістом — обидва "ok".

${SF1_UK_VERIFY_KERNEL}

### 6. НАЗВИ ТА ІНТЕРФЕЙС
- Один шаблон на серію: інше слово для тієї самої якості чи модифікації, ніж у сусідів серії, або прикметник не в роді іменника → **"suspicious"**. Порядок слів у назві — не помилка, якщо зміст збережено.
- Дія на підказці чи кнопці не за списком канону або не інфінітивом → **"suspicious"**: ${interactionVerbs}.
- Бренд латиницею чи в лапках у назві запису; змінена римська цифра або літера супутника планети; перекладена модель (AA-99, Mk II) → **"suspicious"**.
- Назва чи опис навички, риси, стану з родом героя → **"suspicious"**.
- Перекладений службовий рядок (Debug…, Test…, Fallback) → **"suspicious"**; suggestion — source як є.

### 7. ПРИКЛАДИ
${promptJsonItems([
  {
    parts: ['Advanced Rifle'],
    translation_parts: ['Просунутий карабін'],
    verdict: 'suspicious',
    suggestion: ['Удосконалена гвинтівка'],
  },
  {
    parts: ['Search'],
    translation_parts: ['Пошук'],
    verdict: 'suspicious',
    suggestion: ['Обшукати'],
  },
  {
    parts: ['Deals ', 0, ' damage.'],
    translation_parts: ['Наносить ', 0, ' урону.'],
    verdict: 'suspicious',
    suggestion: ['Завдає ', 0, ' шкоди.'],
  },
  {
    parts: ['UC Vanguard Pilot'],
    translation_parts: ['Пілот UC Vanguard'],
    verdict: 'incorrect',
    suggestion: ['Пілот Авангарду ОК'],
  },
])}`;
