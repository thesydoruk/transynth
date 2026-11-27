import { dismissVoiceEffortResult, useNextVoiceEffortResult } from '../../voiceEffortResults';
import { VoiceEffortResultDialog } from './VoiceEffortResultDialog';

/**
 * Shows finished vocal effort analyses one at a time. Mount it once per page:
 * every mounted host would open the same result.
 */
export const VoiceEffortResultHost = ({
  modName,
}: {
  /** Display name of a mod by id; undefined falls back to its id. */
  modName: (modId: number) => string | undefined;
}) => {
  const next = useNextVoiceEffortResult();
  if (!next) return null;
  return (
    <VoiceEffortResultDialog
      result={next.result}
      modName={modName(next.result.modId)}
      onClose={() => dismissVoiceEffortResult(next.jobId)}
    />
  );
};
