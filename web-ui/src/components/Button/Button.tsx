import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Button.module.scss';

export type ButtonVariant = 'primary' | 'success' | 'secondary' | 'neutral' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

/**
 * Props for the shared Button component.
 *
 * Extends native button attributes except direct style/class customization,
 * keeping visual appearance controlled by semantic variant and size props.
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> {
  /** Semantic visual variant. */
  variant?: ButtonVariant;
  /** Predefined size token. */
  size?: ButtonSize;
  /** Button content. */
  children: ReactNode;
}

/**
 * Reusable app button with constrained variants and sizes.
 *
 * This component enforces consistent button styling across modals and pages.
 */
export const Button = ({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  children,
  ...rest
}: ButtonProps) => {
  const className = `${s.button} ${s[size]} ${s[variant]}`;
  return (
    <button type={type} className={className} {...rest}>
      {children}
    </button>
  );
};