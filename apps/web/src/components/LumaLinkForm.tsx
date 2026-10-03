'use client';

/**
 * Paste a public Luma event link. The form posts for real, so submitting still
 * creates the event when the click handler has not attached yet. The handler
 * takes over when it has, and shows the failure on this page.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';

export function LumaLinkForm({ initialError = null }: { initialError?: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/events/from-luma', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as { error?: string; event?: { id: string } };
      if (!response.ok || !payload.event) throw new Error(payload.error ?? 'could not read that Luma page');
      router.push(`/events/${payload.event.id}`);
      router.refresh();
    } catch (submitError) {
      setError((submitError as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="stack" method="post" action="/api/events/from-luma" onSubmit={submit}>
      <p className="small muted">
        Paste a Luma event link. The name, time, and description come from that page.
      </p>
      <div className="luma-row">
        <div className="grow">
          <label htmlFor="luma-url">Luma link</label>
          <input
            id="luma-url"
            name="url"
            type="text"
            inputMode="url"
            placeholder="https://lu.ma/your-event"
            value={url}
            required
            maxLength={500}
            onChange={(change) => setUrl(change.target.value)}
          />
        </div>
        <button type="submit" disabled={busy}>
          <Icon name="calendar" /> {busy ? 'Reading...' : 'Use this page'}
        </button>
      </div>
      {busy ? <p className="small muted">Reading the Luma page...</p> : null}
      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}
    </form>
  );
}
