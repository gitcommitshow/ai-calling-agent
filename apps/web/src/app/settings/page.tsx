/**
 * Org settings: master prompts, dialing defaults, live call limits, the agent
 * hangup tool, models and providers, and which fields may reach the caller.
 */
import Link from 'next/link';
import { SettingsForm } from '../../components/SettingsForm';
import { Icon } from '../../components/Icon';
import { loadSettings, loadVoiceHangup } from '../../lib/server-api';
import type { VoiceHangupStatus } from '../../domain/settings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  try {
    const [settingsResult, voiceHangup] = await Promise.all([
      loadSettings(),
      loadVoiceHangup().catch(
        (error: Error): VoiceHangupStatus => ({
          available: false,
          enabled: false,
          description: '',
          agentId: null,
          error: error.message,
        }),
      ),
    ]);
    const { settings, callingHoursMode, providerAvailability } = settingsResult;
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
            Shared across every event: prompts, default calling hours, live call limits, whether
            the agent can hang up, models and providers, and the fixed test number. Calling hours are{' '}
            {callingHoursMode === 'strict' ? 'strict' : 'soft'} on this server. Last saved{' '}
            {new Date(settings.updatedAt).toLocaleString('en-IN')}.
          </p>
        </div>
        <SettingsForm
          initial={settings}
          callingHoursMode={callingHoursMode}
          providerAvailability={providerAvailability}
          voiceHangup={voiceHangup}
        />
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
