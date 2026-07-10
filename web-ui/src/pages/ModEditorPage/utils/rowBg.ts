import { statusRowBackground } from '../../../components/StatusBadge/statusColors';

/**
 * Returns the CSS background value for a row with the given translation status.
 */
export const rowBg = (status: string | null): string => statusRowBackground(status);
