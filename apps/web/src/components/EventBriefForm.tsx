'use client';

/**
 * The public description the agent may say, plus one notes field for facts
 * that are newer or not on the public page. A Luma refresh replaces the
 * description and leaves the notes.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import type { Event, EventBrief } from '../domain/types';
import { Icon } from './Icon';

/** The public description: the about text, then the place. Notes stay separate. */
function descriptionFromBrief(brief: EventBrief | undefined): string {
  if (!brief) return '';
  return [brief.about.trim(), brief.where.trim() && `Where: ${brief.where.trim()}`]
    .filter((line): line is string => Boolean(line))
    .join('\n\n');
}

export function EventBriefForm({ event }: { event: Event }) {
  const router = useRouter();
  const [description, setDescription] = useState(() => descriptionFromBrief(event.brief));
  const [notes, setNotes] = useState(() => event.brief?.notes ?? '');
  const [notesOpen, setNotesOpen] = useState(() => Boolean(event.brief?.notes.trim()));
  /** Focus the box only after they ask for it, not when saved notes are already showing. */
  const focusNotes = useRef(false);
  const [syncedAt, setSyncedAt] = useState(event.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (event.updatedAt !== syncedAt) {
    setSyncedAt(event.updatedAt);
    const nextNotes = event.brief?.notes ?? '';
    setDescription(descriptionFromBrief(event.brief));
    setNotes(nextNotes);
    setNotesOpen(Boolean(nextNotes.trim()));
  }

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: event.name,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timezone: event.timezone,
          brief: { about: description, where: '', notes },
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not save the description');
      setMessage('Saved. The next call will use this.');
      router.refresh();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshFromLuma() {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/events/${event.id}/refresh-luma`, { method: 'POST' });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not read that Luma page');
      setMessage('Updated the name, time, and description from Luma. Your notes were left as they are.');
      router.refresh();
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <p className="small muted">
        The agent may answer from this description. Leave it blank when a question should become a callback.
      </p>
      {event.sourceUrl ? (
        <p className="small muted">
          <a href={event.sourceUrl}>{event.sourceUrl}</a>
        </p>
      ) : null}
      <div>
        <label htmlFor={`description-${event.id}`}>Description</label>
        <textarea
          id={`description-${event.id}`}
          value={description}
          maxLength={8000}
          rows={6}
          onChange={(change) => setDescription(change.target.value)}
        />
      </div>
      {notesOpen ? (
        <div>
          <label htmlFor={`notes-${event.id}`}>Notes for the agent</label>
          <p className="small muted">
            Use this when the description is out of date, or for details that should not be on the public page. The
            agent follows these notes when they disagree with the description.
          </p>
          <textarea
            id={`notes-${event.id}`}
            value={notes}
            maxLength={4000}
            rows={4}
            autoFocus={focusNotes.current}
            onChange={(change) => setNotes(change.target.value)}
          />
        </div>
      ) : (
        <div>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              focusNotes.current = true;
              setNotesOpen(true);
            }}
          >
            + Add notes for agent
          </button>
        </div>
      )}
      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}
      {message ? <p className="small muted">{message}</p> : null}
      <div className="toolbar">
        <button type="submit" disabled={busy || refreshing}>
          <Icon name="check" /> {busy ? 'Saving...' : 'Save'}
        </button>
        {event.sourceUrl ? (
          <button type="button" className="secondary" disabled={busy || refreshing} onClick={refreshFromLuma}>
            <Icon name="search" /> {refreshing ? 'Checking...' : 'Check latest details'}
          </button>
        ) : null}
      </div>
    </form>
  );
}
