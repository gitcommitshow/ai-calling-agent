/**
 * Global pipeline test: one click calls the fixed test number with the built-in
 * script. Opening the page does not dial.
 */
import Link from 'next/link';
import { TestCallPanel } from '../../components/TestCallPanel';
import { Icon } from '../../components/Icon';
import { getSettings, listTestCalls } from '../../lib/server-api';

export const dynamic = 'force-dynamic';

export default async function GlobalTestPage() {
  try {
    const [settings, testCalls] = await Promise.all([getSettings(), listTestCalls()]);
    return (
      <div className="stack">
        <div>
          <p className="small muted">
            <Link href="/">Events</Link>
            {' · '}
            <Link href="/settings">Settings</Link>
          </p>
          <h1>Pipeline test</h1>
          <p className="muted small">
            Hear the full calling path before any guest is dialed. For an event&apos;s own
            prompt, open that event&apos;s test page.
          </p>
        </div>
        <TestCallPanel
          event={null}
          campaigns={[]}
          settings={settings}
          initialTestCalls={testCalls}
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
