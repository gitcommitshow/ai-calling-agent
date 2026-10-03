'use client';

/**
 * Create an event without a Luma page. The start defaults to five hours from
 * now so the date fields are already a usable choice.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { IST, isoToIstInput, istInputToIso } from '../lib/time';

function hoursFromNow(hours: number): string {
  return isoToIstInput(new Date(Date.now() + hours * 60 * 60 * 1000).toISOString());
}

export function EventForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState(() => hoursFromNow(5));
  const [endsAt, setEndsAt] = useState(() => hoursFromNow(7));
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
          brief: { about: '', where: '', notes: '' },
        }),
      });
      const payload = (await response.json()) as { error?: string; event?: { id: string } };
      if (!response.ok || !payload.event) throw new Error(payload.error ?? 'could not create event');

      setName('');
      setStartsAt(hoursFromNow(5));
      setEndsAt(hoursFromNow(7));
      router.push(`/events/${payload.event.id}`);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <p className="small muted">
        Name and times only. The start is five hours from now. Add a description on the event page.
      </p>
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
        <button type="submit" className="secondary" disabled={busy}>
          <Icon name="calendar" /> {busy ? 'Creating...' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
