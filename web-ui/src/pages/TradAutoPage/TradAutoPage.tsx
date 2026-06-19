import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type TradAutoRule, type TradAutoCandidate, type Mod } from '../../api';
import { getSrcLang, getTgtLang, modListQueryKey } from '../../langDefaults';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { Toast, useToast } from '../../components/Toast';
import { OverflowMenu } from '../../components/OverflowMenu';
import s from './TradAutoPage.module.scss';

/** Default values for the "add rule" form. */
const EMPTY_FORM = {
  game: 'fo4',
  priority: 10,
  pattern: '',
  replacement: '',
  signature: '',
  path: '',
  src_lang: getSrcLang(),
  tgt_lang: getTgtLang(),
  description: '',
  is_active: true,
};

/**
 * TradAutoPage — manage pattern-match automatic translation rules.
 *
 * Lists all TradAuto rules in a table with inline-edit, add form, plus a
 * test panel (dry-run against sample texts) and an apply panel (apply rules
 * to a mod's untranslated strings).
 */
export const TradAutoPage = ({ embedded = false }: { embedded?: boolean }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Add-rule form state ──────────────────────────────────────────────────
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // ── Inline edit state (null = not editing) ───────────────────────────────
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState({ ...EMPTY_FORM });

  // ── Pending delete confirmation ──────────────────────────────────────────
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const { toast, showToast, clearToast } = useToast();

  // ── Test panel state ─────────────────────────────────────────────────────
  const [testText, setTestText] = useState('');
  const [testResults, setTestResults] = useState<
    ({ ruleId: number; translated: string } | null)[] | null
  >(null);

  // ── Apply panel state ────────────────────────────────────────────────────
  const [applyModId, setApplyModId] = useState('');
  const [applyDry, setApplyDry] = useState(true);
  const [applyMsg, setApplyMsg] = useState('');

  // ── Learn panel state ──────────────────────────────────────────────────
  const [learnMinOcc, setLearnMinOcc] = useState(3);
  const [learnCandidates, setLearnCandidates] = useState<TradAutoCandidate[] | null>(null);
  const [learnMsg, setLearnMsg] = useState('');

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: rules, isLoading } = useQuery({
    queryKey: ['tradAutoRules'],
    queryFn: () => api.tradAuto.list(),
  });

  /** Fetch mods list for the apply panel dropdown. */
  const { data: mods } = useQuery({
    queryKey: modListQueryKey(),
    queryFn: () => api.mods.list(),
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const addMut = useMutation({
    mutationFn: () =>
      api.tradAuto.create({
        game: form.game,
        priority: form.priority,
        pattern: form.pattern,
        replacement: form.replacement,
        signature: form.signature || null,
        path: form.path || null,
        src_lang: form.src_lang,
        tgt_lang: form.tgt_lang,
        description: form.description || null,
        is_active: form.is_active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tradAutoRules'] });
      setForm({ ...EMPTY_FORM });
    },
  });

  const updateMut = useMutation({
    mutationFn: (args: {
      id: number;
      data: Partial<Omit<TradAutoRule, 'id' | 'created_at' | 'updated_at'>>;
    }) => api.tradAuto.update(args.id, args.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tradAutoRules'] });
      setEditId(null);
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => api.tradAuto.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tradAutoRules'] });
      showToast(t('tradAuto.deleteSuccess'), 'success');
    },
  });

  const testMut = useMutation({
    mutationFn: (texts: string[]) => api.tradAuto.test(texts),
    onSuccess: (data) => setTestResults(data.results),
  });

  const applyMut = useMutation({
    mutationFn: () => api.tradAuto.apply(Number(applyModId), applyDry),
    onSuccess: (data) => {
      if (data.dryRun) {
        setApplyMsg(t('tradAuto.applyDryResult', { matched: data.matched, total: data.total }));
      } else {
        setApplyMsg(
          t('tradAuto.applyResult', {
            matched: data.matched,
            total: data.total,
            saved: data.saved,
          }),
        );
        qc.invalidateQueries({ queryKey: ['strings'] });
      }
    },
  });

  const learnMut = useMutation({
    mutationFn: () => api.tradAuto.learn({ minOccurrences: learnMinOcc }),
    onSuccess: (data) => {
      setLearnCandidates(data.candidates);
      setLearnMsg(
        data.candidates.length
          ? t('tradAuto.learnFound', { count: data.candidates.length })
          : t('tradAuto.learnNone'),
      );
    },
  });

  /** Approve a discovered candidate — creates it as a real TradAuto rule. */
  const approveMut = useMutation({
    mutationFn: (c: TradAutoCandidate) =>
      api.tradAuto.create({
        game: 'fo4',
        priority: 100,
        pattern: c.pattern,
        replacement: c.replacement,
        signature: c.signature,
        path: c.path,
        src_lang: getSrcLang(),
        tgt_lang: getTgtLang(),
        description: `Learned from TM (${c.occurrences} occurrences)`,
        is_active: true,
      }),
    onSuccess: (_data, candidate) => {
      qc.invalidateQueries({ queryKey: ['tradAutoRules'] });
      setLearnCandidates((prev) =>
        prev
          ? prev.filter(
              (c) => c.pattern !== candidate.pattern || c.replacement !== candidate.replacement,
            )
          : prev,
      );
    },
  });

  /** Enter inline-edit mode for a specific rule row. */
  const startEdit = (rule: TradAutoRule) => {
    setEditId(rule.id);
    setEditData({
      game: rule.game,
      priority: rule.priority,
      pattern: rule.pattern,
      replacement: rule.replacement,
      signature: rule.signature ?? '',
      path: rule.path ?? '',
      src_lang: rule.src_lang,
      tgt_lang: rule.tgt_lang,
      description: rule.description ?? '',
      is_active: rule.is_active,
    });
  };

  /** Commit inline-edit changes. */
  const saveEdit = () => {
    if (editId == null) return;
    updateMut.mutate({
      id: editId,
      data: {
        game: editData.game,
        priority: editData.priority,
        pattern: editData.pattern,
        replacement: editData.replacement,
        signature: editData.signature || null,
        path: editData.path || null,
        src_lang: editData.src_lang,
        tgt_lang: editData.tgt_lang,
        description: editData.description || null,
        is_active: editData.is_active,
      },
    });
  };

  /** Run test — split textarea into lines, send to the backend. */
  const runTest = () => {
    const lines = testText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    testMut.mutate(lines);
  };

  /** Whether the add-form has enough data to submit. */
  const canAdd = !!form.pattern.trim() && !!form.replacement.trim();

  // ── Render ───────────────────────────────────────────────────────────────
  const testLines = testText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <>
      <div className={`${s.page} ${embedded ? s.pageEmbedded : ''}`}>
        <h1 className={s.title}>{t('tradAuto.title')}</h1>
        <p className={s.description}>{t('tradAuto.description')}</p>

        {/* ── Add-rule form ────────────────────────────────────────────────── */}
        <div className={s.addForm}>
          <input
            className={s.inputNarrow}
            type="number"
            placeholder={t('tradAuto.priorityPlaceholder')}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
          />
          <input
            className={s.input}
            placeholder={t('tradAuto.patternPlaceholder')}
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
          />
          <input
            className={s.input}
            placeholder={t('tradAuto.replacementPlaceholder')}
            value={form.replacement}
            onChange={(e) => setForm({ ...form, replacement: e.target.value })}
          />
          <input
            className={s.input}
            placeholder={t('tradAuto.signaturePlaceholder')}
            value={form.signature}
            onChange={(e) => setForm({ ...form, signature: e.target.value })}
          />
          <input
            className={s.input}
            placeholder={t('tradAuto.pathPlaceholder')}
            value={form.path}
            onChange={(e) => setForm({ ...form, path: e.target.value })}
          />
          <input
            className={s.inputWide}
            placeholder={t('tradAuto.descriptionPlaceholder')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && canAdd && addMut.mutate()}
          />
          <button
            className={s.btnAdd}
            disabled={!canAdd || addMut.isPending}
            onClick={() => addMut.mutate()}
          >
            {t('tradAuto.add')}
          </button>
          {addMut.isError && <span className={s.mutError}>{addMut.error?.message}</span>}
        </div>

        {/* ── Rules table ──────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className={s.center}>{t('common.loading')}</div>
        ) : !rules?.length ? (
          <div className={s.center}>
            <p>{t('tradAuto.noRules')}</p>
            <p className={s.emptyHint}>{t('tradAuto.emptyHint')}</p>
          </div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>{t('tradAuto.priority')}</th>
                <th className={s.th}>{t('tradAuto.pattern')}</th>
                <th className={s.th}>{t('tradAuto.replacement')}</th>
                <th className={s.th}>{t('tradAuto.signature')}</th>
                <th className={s.th}>{t('tradAuto.path')}</th>
                <th className={s.th}>{t('tradAuto.descriptionCol')}</th>
                <th className={s.th}>{t('tradAuto.active')}</th>
                <th className={s.th}>{t('tradAuto.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) =>
                editId === rule.id ? (
                  /* ── Inline edit row ─────────────────────────────────────── */
                  <tr key={rule.id}>
                    <td className={s.td}>
                      <input
                        className={s.editInput}
                        type="number"
                        value={editData.priority}
                        onChange={(e) =>
                          setEditData({ ...editData, priority: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className={s.td}>
                      <input
                        className={s.editInput}
                        value={editData.pattern}
                        onChange={(e) => setEditData({ ...editData, pattern: e.target.value })}
                      />
                    </td>
                    <td className={s.td}>
                      <input
                        className={s.editInput}
                        value={editData.replacement}
                        onChange={(e) => setEditData({ ...editData, replacement: e.target.value })}
                      />
                    </td>
                    <td className={s.td}>
                      <input
                        className={s.editInput}
                        value={editData.signature}
                        onChange={(e) => setEditData({ ...editData, signature: e.target.value })}
                      />
                    </td>
                    <td className={s.td}>
                      <input
                        className={s.editInput}
                        value={editData.path}
                        onChange={(e) => setEditData({ ...editData, path: e.target.value })}
                      />
                    </td>
                    <td className={s.td}>
                      <input
                        className={s.editInput}
                        value={editData.description}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                      />
                    </td>
                    <td className={s.td}>
                      <input
                        type="checkbox"
                        checked={editData.is_active}
                        onChange={(e) => setEditData({ ...editData, is_active: e.target.checked })}
                      />
                    </td>
                    <td className={s.td}>
                      <div className={s.editActions}>
                        <button
                          className={s.btnSave}
                          onClick={saveEdit}
                          disabled={updateMut.isPending}
                        >
                          {t('tradAuto.save')}
                        </button>
                        <button className={s.btnCancel} onClick={() => setEditId(null)}>
                          {t('tradAuto.cancel')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  /* ── Display row ─────────────────────────────────────────── */
                  <tr key={rule.id}>
                    <td className={s.td}>{rule.priority}</td>
                    <td className={s.tdMono}>{rule.pattern}</td>
                    <td className={s.tdMono}>{rule.replacement}</td>
                    <td className={rule.signature ? s.tdMono : s.tdAny}>
                      {rule.signature ?? t('tradAuto.anyGrup')}
                    </td>
                    <td className={rule.path ? s.tdMono : s.tdAny}>
                      {rule.path ?? t('tradAuto.anyField')}
                    </td>
                    <td className={s.td}>{rule.description ?? '—'}</td>
                    <td className={s.td}>
                      <span className={rule.is_active ? s.activeOn : s.activeOff}>
                        {rule.is_active ? '✓' : '✗'}
                      </span>
                    </td>
                    <td className={s.td}>
                      <button className={s.btnSmall} onClick={() => startEdit(rule)}>
                        {t('tradAuto.edit')}
                      </button>
                      <OverflowMenu
                        items={[
                          {
                            label: t('tradAuto.delete'),
                            onClick: () => setPendingDeleteId(rule.id),
                            danger: true,
                            disabled: removeMut.isPending,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}

        {/* ── Test & Apply panels ──────────────────────────────────────────── */}
        <div className={s.panels}>
          {/* ── Test panel ─────────────────────────────────────────────────── */}
          <div className={s.panel}>
            <h3 className={s.panelTitle}>{t('tradAuto.testTitle')}</h3>
            <p className={s.panelDesc}>{t('tradAuto.testDescription')}</p>
            <textarea
              className={s.textarea}
              placeholder={t('tradAuto.testPlaceholder')}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
            <Button
              variant="primary"
              disabled={!testText.trim() || testMut.isPending}
              onClick={runTest}
            >
              {t('tradAuto.runTest')}
            </Button>
            {testMut.isError && <span className={s.mutError}>{testMut.error?.message}</span>}
            {testResults && (
              <div className={s.testResults}>
                {testLines.map((line, i) => (
                  <div key={i} className={s.testLine}>
                    <span className={s.testInput}>{line}</span>
                    {testResults[i] ? (
                      <span className={s.testOutput}>
                        → {testResults[i]!.translated}{' '}
                        <small>
                          ({t('tradAuto.testMatch', { ruleId: testResults[i]!.ruleId })})
                        </small>
                      </span>
                    ) : (
                      <span className={s.testNoMatch}>{t('tradAuto.testNoMatch')}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Apply panel ────────────────────────────────────────────────── */}
          <div className={s.panel}>
            <h3 className={s.panelTitle}>{t('tradAuto.applyTitle')}</h3>
            <p className={s.panelDesc}>{t('tradAuto.applyDescription')}</p>
            <div className={s.applyRow}>
              <select
                className={s.select}
                value={applyModId}
                onChange={(e) => {
                  setApplyModId(e.target.value);
                  setApplyMsg('');
                }}
              >
                <option value="">{t('tradAuto.modId')}…</option>
                {mods?.map((m: Mod) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <label className={s.checkLabel}>
                <input
                  type="checkbox"
                  className={s.checkbox}
                  checked={applyDry}
                  onChange={(e) => setApplyDry(e.target.checked)}
                />
                {t('tradAuto.dryRun')}
              </label>
              <Button
                variant="primary"
                disabled={!applyModId || applyMut.isPending}
                onClick={() => applyMut.mutate()}
              >
                {t('tradAuto.apply')}
              </Button>
            </div>
            {applyMut.isError && <span className={s.mutError}>{applyMut.error?.message}</span>}
            {applyMsg && <div className={s.applyMsg}>{applyMsg}</div>}
          </div>
        </div>

        {/* ── Learn from TM panel ──────────────────────────────────────────── */}
        <div className={s.learnSection}>
          <h3 className={s.panelTitle}>{t('tradAuto.learnTitle')}</h3>
          <p className={s.panelDesc}>{t('tradAuto.learnDescription')}</p>
          <div className={s.applyRow}>
            <label className={s.checkLabel}>
              {t('tradAuto.learnMinOcc')}
              <input
                className={s.inputNarrow}
                type="number"
                min={2}
                max={100}
                value={learnMinOcc}
                onChange={(e) => setLearnMinOcc(Number(e.target.value))}
              />
            </label>
            <Button
              variant="primary"
              disabled={learnMut.isPending}
              onClick={() => {
                setLearnMsg('');
                setLearnCandidates(null);
                learnMut.mutate();
              }}
            >
              {learnMut.isPending ? t('tradAuto.learnRunning') : t('tradAuto.learnRun')}
            </Button>
          </div>
          {learnMut.isError && <span className={s.mutError}>{learnMut.error?.message}</span>}
          {learnMsg && <div className={s.applyMsg}>{learnMsg}</div>}

          {learnCandidates && learnCandidates.length > 0 && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>{t('tradAuto.pattern')}</th>
                  <th className={s.th}>{t('tradAuto.replacement')}</th>
                  <th className={s.th}>{t('tradAuto.signature')}</th>
                  <th className={s.th}>{t('tradAuto.path')}</th>
                  <th className={s.th}>{t('tradAuto.learnOccurrences')}</th>
                  <th className={s.th}>{t('tradAuto.learnExamples')}</th>
                  <th className={s.th}>{t('tradAuto.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {learnCandidates.map((c, idx) => (
                  <tr key={idx}>
                    <td className={s.tdMono}>{c.pattern}</td>
                    <td className={s.tdMono}>{c.replacement}</td>
                    <td className={c.signature ? s.tdMono : s.tdAny}>
                      {c.signature ?? t('tradAuto.anyGrup')}
                    </td>
                    <td className={c.path ? s.tdMono : s.tdAny}>
                      {c.path ?? t('tradAuto.anyField')}
                    </td>
                    <td className={s.td}>{c.occurrences}</td>
                    <td className={s.td}>
                      <details className={s.examplesDetails}>
                        <summary>
                          {c.examples.length} {t('tradAuto.learnPairs')}
                        </summary>
                        {c.examples.map((ex, i) => (
                          <div key={i} className={s.exampleLine}>
                            <span className={s.testInput}>{ex.source}</span>
                            <span className={s.testOutput}>→ {ex.target}</span>
                          </div>
                        ))}
                      </details>
                    </td>
                    <td className={s.td}>
                      <button
                        className={s.btnAdd}
                        disabled={approveMut.isPending}
                        onClick={() => approveMut.mutate(c)}
                      >
                        {t('tradAuto.learnApprove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {pendingDeleteId != null && (
        <ConfirmModal
          title={t('tradAuto.deleteTitle')}
          message={t('tradAuto.deleteMessage')}
          confirmLabel={t('tradAuto.delete')}
          pending={removeMut.isPending}
          onConfirm={() => {
            removeMut.mutate(pendingDeleteId!);
            setPendingDeleteId(null);
          }}
          onClose={() => setPendingDeleteId(null)}
        />
      )}
      <Toast message={toast?.message ?? null} type={toast?.type} onDismiss={clearToast} />
    </>
  );
};
