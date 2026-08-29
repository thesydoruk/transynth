import { useTranslation } from 'react-i18next';
import s from './LoadingState.module.scss';

interface LoadingStateProps {
  /** Optional custom loading message. If not provided, uses default 'common.loading'. */
  message?: string;
}

/**
 * Standardized loading state component.
 *
 * Renders a centered spinner with an optional message.
 * Used across pages to provide a consistent loading experience.
 *
 * @example
 * if (isLoading) return <LoadingState />;
 * // or with custom message:
 * if (isLoading) return <LoadingState message={t('dashboard.loadingDashboard')} />;
 */
export const LoadingState = ({ message }: LoadingStateProps) => {
  const { t } = useTranslation();
  const displayMessage = message ?? t('common.loading');

  return (
    <div className={s.container}>
      <div className={s.spinner} />
      <p className={s.message}>{displayMessage}</p>
    </div>
  );
};
