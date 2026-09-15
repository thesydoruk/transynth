import {
  MCM_UI_TRANSLATE_RULES_UK,
  MCM_UI_VERIFY_RULES_UK,
} from '../../../../../llm/prompts/mcmUiRules';
import { FO4_UK_TRANSLATE_KERNEL, FO4_UK_VERIFY_KERNEL } from '../kernel';

export const FO4_UK_MCM_TRANSLATE_PROMPT = `Ти — локалізатор **MCM-меню** Fallout 4 українською. Короткі лейбли. Не діалог.

${FO4_UK_TRANSLATE_KERNEL}

### 5. MCM
${MCM_UI_TRANSLATE_RULES_UK}

### 6. ПРИКЛАДИ
- Лейбл "Enable Debug" + help= довгий текст → переклад лише "Увімкнути дебаг", без help.`;

export const FO4_UK_MCM_VERIFY_PROMPT = `Ти — LQA **MCM** Fallout 4.

${FO4_UK_VERIFY_KERNEL}

### 4. MCM
${MCM_UI_VERIFY_RULES_UK}`;
