import type { DialogEntry, DialogLine } from '../../../../../../api';
import type { DialogReviewStatus } from '../../hooks/useDialogLineSave';
import type { DialogLineVoice } from '../../hooks/useDialogVoice';
import type { CommitAdvance } from '../DialogLineRow';

/**
 * Cursor state and edit callbacks handed down to every line of the transcript.
 *
 * Bundled into one object so entry cards stay pass-through and only the
 * transcript root knows how editing is wired.
 */
export interface DialogLineHandlers {
  focusedId: number | null;
  editingId: number | null;
  /** Lines with a save in flight. */
  pendingIds: ReadonlySet<number>;
  onFocus: (line: DialogLine) => void;
  onEdit: (line: DialogLine) => void;
  onCancel: () => void;
  onCommit: (line: DialogLine, text: string, advance: CommitAdvance) => void;
  onSetStatus: (line: DialogLine, status: DialogReviewStatus) => void;
  /** Playback controls for the line, or null when it has no voice-over. */
  voiceFor: (entry: DialogEntry, line: DialogLine) => DialogLineVoice | null;
}
