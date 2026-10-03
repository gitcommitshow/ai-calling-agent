/**
 * Short inheritance note under a setting. The title attribute carries the
 * longer rule for hover and long-press tooltips.
 */
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Longer explanation shown on hover. */
  detail: string;
}

export function SettingHint({ children, detail }: Props) {
  return (
    <p className="small muted setting-hint" title={detail}>
      {children}
    </p>
  );
}
