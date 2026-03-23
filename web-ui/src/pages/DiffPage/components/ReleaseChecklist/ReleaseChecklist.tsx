import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ActivityEntry } from '../../../../api';
import s from './ReleaseChecklist.module.scss';

export interface ReleaseChecklistActivityItem {
  id: ActivityEntry['id'];
  action: ActivityEntry['action'];
  createdAt: ActivityEntry['created_at'];
  actor: string | null;
}

export interface ReleaseChecklistProps {
  hasCompared: boolean;
  carryOverDone: boolean;
  draftCount: number;
  qaIssueCount: number;
  translated: number;
  total: number;
  editorTo: string | null;
  draftReviewTo: string | null;
  qaTo: string | null;
  activityTo: string | null;
  recentActivity: ReleaseChecklistActivityItem[];
}

/**
 * Pre-release checklist shown on the Diff page after a version comparison.
 *
 * Keeps the post-import workflow explicit: carry over translations, review
 * drafts, resolve QA, complete coverage, and then jump back to the editor for
 * export packaging.
 */
export const ReleaseChecklist = ({
  hasCompared,
  carryOverDone,
  draftCount,
  qaIssueCount,
  translated,
  total,
  editorTo,
  draftReviewTo,
  qaTo,
  activityTo,
  recentActivity,
}: ReleaseChecklistProps) => {
  const { t } = useTranslation();

  const hasCoverageTarget = total > 0;
  const coverageDone = hasCoverageTarget && translated >= total;
  const releaseReady = hasCompared && carryOverDone && coverageDone && draftCount === 0 && qaIssueCount === 0;

  const checklistItems = [
    { done: hasCompared, label: t('diff.stepCompared'), meta: null },
    { done: carryOverDone, label: t('diff.stepCarryOver'), meta: null },
    { done: draftCount === 0, label: t('diff.stepReviewDrafts'), meta: draftCount > 0 ? t('diff.itemCount', { count: draftCount }) : null },
    { done: qaIssueCount === 0, label: t('diff.stepResolveQa'), meta: qaIssueCount > 0 ? t('diff.itemCount', { count: qaIssueCount }) : null },
    { done: coverageDone, label: t('diff.stepCompleteCoverage'), meta: hasCoverageTarget ? `${translated}/${total}` : null },
    { done: releaseReady, label: t('diff.stepExport'), meta: null },
  ];

  const nextActions: Array<{ key: string; to: string | null; label: string; primary?: boolean }> = [];
  if (draftCount > 0 && draftReviewTo) {
    nextActions.push({ key: 'drafts', to: draftReviewTo, label: t('diff.actionOpenDrafts', { count: draftCount }), primary: true });
  }
  if (qaIssueCount > 0 && qaTo) {
    nextActions.push({ key: 'qa', to: qaTo, label: t('diff.actionOpenQa', { count: qaIssueCount }), primary: !nextActions.length });
  }
  if (!coverageDone && editorTo) {
    nextActions.push({ key: 'coverage', to: editorTo, label: t('diff.actionContinueTranslating'), primary: !nextActions.length });
  }
  if (releaseReady && editorTo) {
    nextActions.push({ key: 'export', to: editorTo, label: t('diff.actionOpenEditorForExport'), primary: true });
  }
  if (activityTo) {
    nextActions.push({ key: 'activity', to: activityTo, label: t('diff.actionOpenAuditTrail') });
  }

  return (
    <section className={s.card} aria-label={t('diff.checklistTitle')}>
      <div className={s.header}>
        <div>
          <h2 className={s.title}>{t('diff.checklistTitle')}</h2>
          <p className={s.subtitle}>{t('diff.checklistSubtitle')}</p>
        </div>
        <span className={releaseReady ? s.statusReady : s.statusPending}>
          {releaseReady ? t('diff.statusReady') : t('diff.statusPending')}
        </span>
      </div>

      <div className={s.summaryRow}>
        <div className={s.summaryCard}>
          <span className={s.summaryLabel}>{t('diff.summaryCoverage')}</span>
          <span className={s.summaryValue}>{hasCoverageTarget ? `${translated}/${total}` : '0/0'}</span>
        </div>
        <div className={s.summaryCard}>
          <span className={s.summaryLabel}>{t('diff.summaryDrafts')}</span>
          <span className={s.summaryValue}>{draftCount}</span>
        </div>
        <div className={s.summaryCard}>
          <span className={s.summaryLabel}>{t('diff.summaryQa')}</span>
          <span className={s.summaryValue}>{qaIssueCount}</span>
        </div>
      </div>

      <ul className={s.list}>
        {checklistItems.map((item) => (
          <li key={item.label} className={item.done ? s.itemDone : s.itemPending}>
            <span className={s.marker} aria-hidden="true">{item.done ? '✓' : '○'}</span>
            <span className={s.itemLabel}>{item.label}</span>
            {item.meta && <span className={s.itemMeta}>{item.meta}</span>}
          </li>
        ))}
      </ul>

      <div className={s.actions}>
        {nextActions.length > 0 ? nextActions.map((action) => (
          action.to ? (
            <Link key={action.key} to={action.to} className={action.primary ? s.actionPrimary : s.actionSecondary}>
              {action.label}
            </Link>
          ) : null
        )) : <span className={s.allClear}>{t('diff.allClear')}</span>}
      </div>

      <div className={s.auditBlock}>
        <div className={s.auditHeader}>
          <h3 className={s.auditTitle}>{t('diff.auditTitle')}</h3>
          {activityTo && (
            <Link to={activityTo} className={s.auditLink}>
              {t('diff.auditOpenFull')}
            </Link>
          )}
        </div>
        {recentActivity.length > 0 ? (
          <ul className={s.auditList}>
            {recentActivity.map((entry) => (
              <li key={entry.id} className={s.auditItem}>
                <span className={s.auditAction}>{entry.action}</span>
                <span className={s.auditMeta}>
                  {entry.actor ?? t('diff.auditUnknownActor')} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.auditEmpty}>{t('diff.auditEmpty')}</p>
        )}
      </div>
    </section>
  );
};