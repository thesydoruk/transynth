import { useState } from 'react';

/** Modal visibility flags for the mod editor page. */
export function useEditorModals() {
  const [showSearchReplace, setShowSearchReplace] = useState(false);
  const [showApplyTranslationFromMod, setShowApplyTranslationFromMod] = useState(false);
  const [showAiVerify, setShowAiVerify] = useState(false);
  const [showBookEditor, setShowBookEditor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  return {
    showSearchReplace,
    setShowSearchReplace,
    showApplyTranslationFromMod,
    setShowApplyTranslationFromMod,
    showAiVerify,
    setShowAiVerify,
    showBookEditor,
    setShowBookEditor,
    showShortcuts,
    setShowShortcuts,
  };
}
