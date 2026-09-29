'use client';

/**
 * Create an event. A CSV carries no event details, so the organizer enters the
 * name and the start and end time, read as Asia/Kolkata wall-clock time.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { IST, istInputToIso } from '../lib/time';

export function EventForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          startsAt: istInputToIso(startsAt),
          endsAt: istInputToIso(endsAt),
          timezone: IST,
        }),
      });
      const payload = (await response.json()) as { error?: string; event?: { id: string } };
      if (!response.ok || !payload.event) throw new Error(payload.error ?? 'could not create event');

      setName('');
      setStartsAt('');
      setEndsAt('');
      router.push(`/events/${payload.event.id}`);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid">
        <div>
          <label htmlFor="event-name">Event name</label>
          <input
            id="event-name"
            value={name}
            required
            maxLength={200}
            onChange={(changeEvent) => setName(changeEvent.target.value)}
          />
        </div>
        <div>
          <label htmlFor="event-starts">Starts ({IST})</label>
          <input
            id="event-starts"
            type="datetime-local"
            value={startsAt}
            required
            onChange={(changeEvent) => setStartsAt(changeEvent.target.value)}
          />
        </div>
        <div>
          <label htmlFor="event-ends">Ends ({IST})</label>
          <input
            id="event-ends"
            type="datetime-local"
            value={endsAt}
            required
            onChange={(changeEvent) => setEndsAt(changeEvent.target.value)}
          />
        </div>
      </div>
      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={busy}>
          <Icon name="calendar" /> {busy ? 'Creating...' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
