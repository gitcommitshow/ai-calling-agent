/**
 * Event pipeline test: one click calls the fixed test number with this event's
 * prompt and a stand-in guest. Opening the page does not dial.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TestCallPanel } from '../../../../components/TestCallPanel';
import { Icon } from '../../../../components/Icon';
import {
  getEvent,
  getSettings,
  listCampaigns,
  listTestCalls,
  ServerApiError,
} from '../../../../lib/server-api';

export const dynamic = 'force-dynamic';

export default async function EventTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const [event, campaigns, settings, testCalls] = await Promise.all([
      getEvent(id),
      listCampaigns(id),
      getSettings(),
      listTestCalls(id),
    ]);

    return (
      <div className="stack">
        <div>
          <p className="small muted">
            <Link href="/">Events</Link>
            {' · '}
            <Link href={`/events/${event.id}`}>{event.name}</Link>
            {' · '}
            <Link href="/test">Global test</Link>
          </p>
          <h1>Test: {event.name}</h1>
          <p className="muted small">
            The answerer hears this event&apos;s script, with a stand-in attendee. Guest
            results stay empty.
          </p>
        </div>
        <TestCallPanel
          event={event}
          campaigns={campaigns}
          settings={settings}
          initialTestCalls={testCalls}
        />
      </div>
    );
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) notFound();
    return (
      <p className="notice error">
        <Icon name="alert" /> {(error as Error).message}
      </p>
    );
  }
}
