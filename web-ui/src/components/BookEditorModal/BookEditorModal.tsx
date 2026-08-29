/**
 * BookEditorModal — split-pane WYSIWYG-style editor for in-game book records.
 *
 * Fallout 4 in-game books (BOOK records, DESC subrecord) use a restricted
 * subset of HTML: `<font>`, `<div>`, `<p>`, `<br>`, `<b>`, `<i>`,
 * `<img src="img://...">`, `<hr>` and numeric character references.
 * The game renders these in its own layout engine, but the browser
 * approximates the look well enough for translation purposes.
 *
 * Layout:
 *   ┌──────────────┬──────────────┐
 *   │  Raw markup  │ Live preview │
 *   │  (textarea)  │  (iframe)    │
 *   └──────────────┴──────────────┘
 *
 * Security note:
 *   The preview `<iframe>` uses `srcdoc` with `sandbox="allow-same-origin"`.
 *   No scripts, no forms — only static rendering.
 *   User-controlled HTML is contained inside the iframe and never written to
 *   the parent DOM via `dangerouslySetInnerHTML`.
 *
 * Props:
 *   @param source        - Original source text (shown read-only on the left).
 *   @param translation   - Current draft translation (editable on the right).
 *   @param onSave        - Called with the new markup string when the user saves.
 *   @param onClose       - Called when the modal is dismissed without saving.
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { ModalShell } from '../ModalShell';
import s from './BookEditorModal.module.scss';

// ── Iframe preview helpers ─────────────────────────────────────────────────

/**
 * Bethesda book preview stylesheet injected into the sandboxed iframe.
 * Approximates the look of Fallout 4's in-game Pip-Boy book renderer.
 * Uses a dark parchment-like theme matching the game's aesthetic.
 */
const PREVIEW_CSS = `
  html, body {
    margin: 0;
    padding: 12px 16px;
    background: #1a1a12;
    color: #c8c8a0;
    font-family: 'Roboto Condensed', 'Segoe UI', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    word-break: break-word;
  }
  font[color] { /* game overrides color via attribute */ }
  font[size="1"] { font-size: 10px; }
  font[size="2"] { font-size: 12px; }
  font[size="3"] { font-size: 14px; }
  font[size="4"] { font-size: 18px; }
  font[size="5"] { font-size: 22px; }
  hr {
    border: none;
    border-top: 1px solid #4a4a30;
    margin: 10px 0;
  }
  /* Game uses img://... scheme — replace with a placeholder box */
  img {
    display: inline-block;
    background: #2a2a1a;
    border: 1px dashed #4a4a30;
    width: 64px;
    height: 32px;
    vertical-align: middle;
  }
  b, strong { color: #e0e0b0; }
  div, p     { margin: 4px 0; }
`;

/**
 * Build the srcdoc string for the iframe preview panel.
 * Wraps the provided HTML in a full document with the preview stylesheet.
 *
 * @param html - Raw markup string (may be empty or partial).
 * @returns Full HTML document string safe for use as srcdoc.
 */
const buildSrcdoc = (html: string): string => {
  // Replace the game's img:// protocol with a placeholder data-src so the
  // browser doesn't make spurious network requests.
  const sanitized = html.replace(/src\s*=\s*["']img:\/\/[^"']*["']/gi, 'data-game-img="1"');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PREVIEW_CSS}</style></head><body>${sanitized}</body></html>`;
};

// ── Component ──────────────────────────────────────────────────────────────

interface BookEditorModalProps {
  /** Read-only source text shown in the left panel. */
  source: string;
  /** The current translation draft (initially populated from the saved value). */
  translation: string;
  /** Called with the edited markup when the user clicks Save. */
  onSave: (markup: string) => void;
  /** Called when the user dismisses without saving. */
  onClose: () => void;
}

/**
 * Detect whether a string contains HTML-like markup.
 * Used to decide whether the preview panel shows rendered content or plain text.
 *
 * @param text - String to inspect.
 * @returns True when the string contains at least one HTML tag or entity.
 */
const hasHtmlMarkup = (text: string): boolean => {
  return /<[a-zA-Z][^>]*>|&[a-zA-Z#][a-zA-Z0-9]*;/.test(text);
};

export const BookEditorModal = ({ source, translation, onSave, onClose }: BookEditorModalProps) => {
  const { t } = useTranslation();

  /** Local draft markup — editable, not yet saved. */
  const [draft, setDraft] = useState(translation);

  /** Whether the source panel shows rendered preview (true) or raw text (false). */
  const [sourcePreview, setSourcePreview] = useState(hasHtmlMarkup(source));

  /** Whether the translation panel shows rendered preview or raw textarea. */
  const [translPreview, setTranslPreview] = useState(false);

  /** Ref to the translation textarea for focus-on-open. */
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Focus the translation textarea when the modal first mounts. */
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  /** Save on Ctrl+Enter. */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onSave(draft);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [draft, onSave, onClose]);

  const header = (
    <div className={s.header}>
      <span className={s.headerIcon}>📖</span>
      <div className={s.headerText}>
        <p className={s.title}>{t('bookEditor.title')}</p>
        <p className={s.subtitle}>{t('bookEditor.subtitle')}</p>
      </div>
      <button className={s.closeBtn} onClick={onClose} aria-label={t('common.close')}>
        ✕
      </button>
    </div>
  );

  return (
    <ModalShell onClose={onClose} customHeader={header} hideCloseButton>
      {/* ── Modal header ──────────────────────────────────────────────── */}

      {/* ── Split panels ──────────────────────────────────────────────── */}
      <div className={s.panels}>
        {/* Left — source (read-only) */}
        <div className={s.panel}>
          <div className={s.panelHeader}>
            <span className={s.panelTitle}>{t('bookEditor.sourceLabel')}</span>
            <button
              className={`${s.previewToggle} ${sourcePreview ? s.previewToggleActive : ''}`}
              onClick={() => setSourcePreview((v) => !v)}
              title={t(sourcePreview ? 'bookEditor.showRaw' : 'bookEditor.showPreview')}
            >
              {sourcePreview ? t('bookEditor.rawBtn') : t('bookEditor.previewBtn')}
            </button>
          </div>
          {sourcePreview ? (
            <iframe
              className={s.previewFrame}
              srcDoc={buildSrcdoc(source)}
              sandbox="allow-same-origin"
              title={t('bookEditor.sourcePreviewTitle')}
            />
          ) : (
            <textarea className={s.textarea} readOnly value={source} />
          )}
        </div>

        {/* Right — translation (editable) */}
        <div className={s.panel}>
          <div className={s.panelHeader}>
            <span className={s.panelTitle}>{t('bookEditor.translationLabel')}</span>
            <button
              className={`${s.previewToggle} ${translPreview ? s.previewToggleActive : ''}`}
              onClick={() => setTranslPreview((v) => !v)}
              title={t(translPreview ? 'bookEditor.showRaw' : 'bookEditor.showPreview')}
            >
              {translPreview ? t('bookEditor.rawBtn') : t('bookEditor.previewBtn')}
            </button>
          </div>
          {translPreview ? (
            <iframe
              className={s.previewFrame}
              srcDoc={buildSrcdoc(draft)}
              sandbox="allow-same-origin"
              title={t('bookEditor.translPreviewTitle')}
            />
          ) : (
            <textarea
              ref={textareaRef}
              className={s.textarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('bookEditor.placeholder')}
              spellCheck={false}
            />
          )}
        </div>
      </div>

      {/* ── Helper info bar ───────────────────────────────────────────── */}
      <div className={s.infoBar}>
        <span className={s.infoText}>{t('bookEditor.markupHint')}</span>
        <span className={s.charCount}>{t('bookEditor.charCount', { count: draft.length })}</span>
      </div>

      {/* ── Action buttons ────────────────────────────────────────────── */}
      <div className={s.footer}>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={() => onSave(draft)} title="Ctrl+Enter">
          {t('common.save')}
        </Button>
      </div>
    </ModalShell>
  );
};
