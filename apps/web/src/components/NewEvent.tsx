'use client';

/**
 * The home page way to add an event: paste a Luma link. Entering the name and
 * times by hand stays behind a small link.
 */
import { useState } from 'react';
import { EventForm } from './EventForm';
import { LumaLinkForm } from './LumaLinkForm';

export function NewEvent({ lumaError = null }: { lumaError?: string | null }) {
  const [manual, setManual] = useState(false);

  return (
    <div className="stack">
      <LumaLinkForm initialError={lumaError} />
      {manual ? (
        <EventForm />
      ) : (
        <p className="small">
          <button type="button" className="link" onClick={() => setManual(true)}>
            Enter an event yourself
          </button>
        </p>
      )}
    </div>
  );
}
