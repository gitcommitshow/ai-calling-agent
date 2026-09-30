/**
 * Org settings: master prompts, dialing defaults for new campaigns, live call
 * limits, and which guest/event fields may reach the AI calling infrastructure.
 */
import Link from 'next/link';
import { SettingsForm } from '../../components/SettingsForm';
import { Icon } from '../../components/Icon';
import { loadSettings } from '../../lib/server-api';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  try {
    const { settings, callingHoursMode } = await loadSettings();
    return (
      <div className="stack">
        <div>
          <p className="small muted">
            <Link href="/">Events</Link>
            {' · '}
            <Link href="/test">Pipeline test</Link>
          </p>
          <h1>Settings</h1>
          <p className="muted small">
            Shared across every event: prompts, default calling hours, live call limits, and the
            fixed test number. Calling hours are{' '}
            {callingHoursMode === 'strict' ? 'strict' : 'soft'} on this server. Last saved{' '}
            {new Date(settings.updatedAt).toLocaleString('en-IN')}.
          </p>
        </div>
        <SettingsForm initial={settings} callingHoursMode={callingHoursMode} />
      </div>
    );
  } catch (error) {
    return (
      <p className="notice error">
        <Icon name="alert" /> {(error as Error).message}
      </p>
    );
  }
}
