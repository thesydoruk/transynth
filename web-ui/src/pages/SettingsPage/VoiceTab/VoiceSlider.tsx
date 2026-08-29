import { useEffect, useState } from 'react';
import parentS from '../SettingsPage.module.scss';
import controlS from '../WorkflowTab/WorkflowTab.module.scss';
import s from './VoiceTab.module.scss';

type VoiceSliderProps = {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  formatValue?: (value: number) => string;
  onCommit: (value: number) => void;
};

const formatDefault = (value: number, step: number): string =>
  step >= 1 ? String(Math.round(value)) : value.toFixed(2);

/** Labeled range slider with live value preview; persists on release or blur. */
export const VoiceSlider = ({
  label,
  description,
  value,
  min,
  max,
  step,
  disabled = false,
  formatValue,
  onCommit,
}: VoiceSliderProps) => {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const display = formatValue?.(local) ?? formatDefault(local, step);

  const commitFromInput = (input: HTMLInputElement) => {
    const next = Number.parseFloat(input.value);
    if (Number.isNaN(next)) return;
    const clamped = Math.min(max, Math.max(min, next));
    setLocal(clamped);
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className={`${controlS.settingRow} ${s.sliderRow}`}>
      <div className={s.sliderHeader}>
        <div className={controlS.settingInfo}>
          <span className={controlS.settingLabel}>{label}</span>
          <span className={parentS.fieldNote}>{description}</span>
        </div>
        <span className={s.sliderValue} aria-live="polite">
          {display}
        </span>
      </div>
      <input
        type="range"
        className={s.sliderInput}
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={local}
        aria-label={label}
        onChange={(e) => setLocal(Number.parseFloat(e.target.value))}
        onPointerUp={(e) => commitFromInput(e.currentTarget)}
        onBlur={(e) => commitFromInput(e.currentTarget)}
      />
    </div>
  );
};
