import { useEffect, useState } from 'react';
import { getSrcLang, getTgtLang, LS_SRC_LANG, LS_TGT_LANG } from '../langDefaults';

/** Live source/target content languages from Settings (updates on change without reload). */
export const useContentLangs = () => {
  const [langs, setLangs] = useState(() => ({
    srcLang: getSrcLang(),
    targetLang: getTgtLang(),
  }));

  useEffect(() => {
    const sync = () => setLangs({ srcLang: getSrcLang(), targetLang: getTgtLang() });

    const handleStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === LS_SRC_LANG || event.key === LS_TGT_LANG) {
        sync();
      }
    };

    window.addEventListener('content-language-change', sync);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('content-language-change', sync);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', sync);
    };
  }, []);

  return langs;
};
