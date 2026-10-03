'use client';

/**
 * Questions a call could not answer. Each one can start a follow-up call or be
 * marked resolved once a person has answered it. Calling does not resolve it.
 * Outside calling hours needs the same double confirmation as other dials.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from './Icon';
import {
  OutsideWindowConfirm,
  type OutsideWindowStep,
} from './OutsideWindowConfirm';
import type { CallingHoursMode } from '../domain/settings';
import type { CallingWindow } from '../domain/types';

export interface OpenQuestionRow {
  questionId: string;
  text: string;
  attemptId: string;
  guestName: string;
  campaignId: string;
  campaignName: string;
  guestId: string;
}

/** Pull hours out of a server refusal so the confirm dialog can name them. */
function windowFromRefusal(message: string): CallingWindow | null {
  const match = message.match(
    /outside the calling window \((\d{2}:\d{2})-(\d{2}:\d{2}) ([^)]+)\)/i,
  );
  if (!match) return null;
  return { start: match[1]!, end: match[2]!, timezone: match[3]! };
}

export function OpenQuestions({
  eventId,
  rows,
  callingHoursMode = 'soft',
}: {
  eventId: string;
  rows: OpenQuestionRow[];
  /** Strict refuses outside-hours dials. Soft opens the two-step confirmation. */
  callingHoursMode?: CallingHoursMode;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outsideStep, setOutsideStep] = useState<OutsideWindowStep>('idle');
  const [pending, setPending] = useState<{
    row: OpenQuestionRow;
    window: CallingWindow;
    strict: boolean;
  } | null>(null);

  if (rows.length === 0) return null;

  async function callBack(row: OpenQuestionRow, waiveCallingWindow = false) {
    setBusyId(row.questionId);
    setNotes((current) => ({ ...current, [row.questionId]: 'Starting the call...' }));
    try {
      const response = await fetch(`/api/campaigns/${row.campaignId}/calls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestId: row.guestId,
          openQuestionId: row.questionId,
          ...(waiveCallingWindow ? { waiveCallingWindow: true } : {}),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        const message = payload.error ?? 'the call was refused';
        const window = !waiveCallingWindow ? windowFromRefusal(message) : null;
        if (window) {
          setPending({
            row,
            window,
            strict: callingHoursMode === 'strict' || message.includes('STRICT_CALLING_HOURS'),
          });
          setOutsideStep('ack');
          setNotes((current) => ({ ...current, [row.questionId]: message }));
          return;
        }
        throw new Error(message);
      }
      setOutsideStep('idle');
      setPending(null);
      setNotes((current) => ({
        ...current,
        [row.questionId]: `Calling ${row.guestName}. This question stays open until you mark it answered.`,
      }));
      router.refresh();
    } catch (error) {
      setNotes((current) => ({ ...current, [row.questionId]: (error as Error).message }));
    } finally {
      setBusyId(null);
    }
  }

  async function resolve(row: OpenQuestionRow) {
    setBusyId(row.questionId);
    try {
      const response = await fetch(
        `/api/events/${eventId}/attempts/${row.attemptId}/questions/${row.questionId}/resolve`,
        { method: 'POST' },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not mark it resolved');
      router.refresh();
    } catch (error) {
      setNotes((current) => ({ ...current, [row.questionId]: (error as Error).message }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <h2>Questions to call back</h2>
      <p className="small muted">
        The call did not have these answers. Call the guest, then mark the question resolved once
        you have answered it.
      </p>
      {pending ? (
        <OutsideWindowConfirm
          window={pending.window}
          step={outsideStep}
          busy={busyId === pending.row.questionId}
          mode={pending.strict ? 'strict' : 'soft'}
          confirmLabel="Call anyway"
          onAck={() => setOutsideStep('final')}
          onConfirm={() => void callBack(pending.row, true)}
          onCancel={() => {
            setOutsideStep('idle');
            setPending(null);
          }}
        />
      ) : null}
      <div className="card-grid">
        {rows.map((row) => (
          <article key={row.questionId} className="entity-card">
            <div className="entity-card-head">
              <div>
                <h3>{row.guestName}</h3>
                <span className="chip strong">
                  <Icon name="speech" /> Needs a callback
                </span>
              </div>
            </div>
            <p>{row.text}</p>
            <p className="small muted">{row.campaignName}</p>
            <div className="toolbar">
              <a className="chip" href={`#attempt-${row.attemptId}`}>
                <Icon name="list" /> View the call
              </a>
              <button
                type="button"
                className="tiny"
                disabled={busyId === row.questionId || outsideStep !== 'idle'}
                onClick={() => void callBack(row)}
              >
                <Icon name="phone" /> Call {row.guestName}
              </button>
              <button
                type="button"
                className="secondary tiny"
                disabled={busyId === row.questionId}
                onClick={() => void resolve(row)}
              >
                <Icon name="check" /> Mark answered
              </button>
            </div>
            {notes[row.questionId] ? <p className="small muted">{notes[row.questionId]}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
