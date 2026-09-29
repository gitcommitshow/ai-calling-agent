'use client';

/**
 * Luma CSV upload. Parsing and mapping happen here so the organizer sees the
 * skip report before anything is saved; submitting sends the mapped payload.
 */
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import { Icon } from './Icon';
import { APPROVAL_STATUS_ICONS } from './status-icons';
import { parseLumaCsv, type LumaImportResult } from '../domain/luma-csv';
import { APPROVAL_STATUSES, APPROVAL_STATUS_LABELS, type ApprovalStatus } from '../domain/types';

interface Props {
  eventId: string;
  guestCount: number;
}

/** Status tally in a fixed order, so the preview reads the same every time. */
function statusCounts(preview: LumaImportResult): { status: ApprovalStatus; count: number }[] {
  return APPROVAL_STATUSES.map((status) => ({
    status,
    count: preview.guests.filter((guest) => guest.approvalStatus === status).length,
  })).filter((entry) => entry.count > 0);
}

export function GuestImport({ eventId, guestCount }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState<LumaImportResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(changeEvent: ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0];
    setError(null);
    setPreview(null);
    if (!file) return;

    setFileName(file.name);
    try {
      setPreview(parseLumaCsv(await file.text()));
    } catch (parseError) {
      setError(`could not read the CSV: ${(parseError as Error).message}`);
    }
  }

  async function submit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/guests/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guests: preview.guests,
          skippedWithoutPhone: preview.skippedWithoutPhone,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'import failed');

      setPreview(null);
      setFileName('');
      router.refresh();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <label htmlFor="csv">
          <Icon name="upload" /> Luma guest CSV
        </label>
        <input id="csv" type="file" accept=".csv,text/csv" onChange={onFile} />
        <p className="small muted">
          Importing replaces the current guest list ({guestCount} guests). Guests without a callable
          Indian number are skipped.
        </p>
      </div>

      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}

      {preview ? (
        <div className="notice stack">
          <h3>
            {fileName}: {preview.guests.length} of {preview.totalRows} rows importable
          </h3>

          <div className="toolbar">
            <span className="chip strong">
              <Icon name="users" /> {preview.guests.length} importable
            </span>
            <span className="chip">
              <Icon name="phoneOff" /> {preview.skippedWithoutPhone} skipped
            </span>
            {preview.duplicateRows > 0 ? (
              <span className="chip">
                <Icon name="stack" /> {preview.duplicateRows} duplicates merged
              </span>
            ) : null}
          </div>

          <div className="toolbar">
            {statusCounts(preview).map(({ status, count }) => (
              <span key={status} className="chip">
                <Icon name={APPROVAL_STATUS_ICONS[status]} /> {APPROVAL_STATUS_LABELS[status]}:{' '}
                {count}
              </span>
            ))}
          </div>

          {preview.parseErrors.length > 0 ? (
            <ul className="small">
              {preview.parseErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}

          {preview.skipped.length > 0 ? (
            <details>
              <summary className="small">
                <Icon name="phoneOff" /> Show skipped rows ({preview.skipped.length})
              </summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>CSV row</th>
                      <th>Guest</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.skipped.slice(0, 50).map((row) => (
                      <tr key={`${row.row}-${row.name}`}>
                        <td>{row.row}</td>
                        <td>{row.name}</td>
                        <td className="muted">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          <div className="toolbar">
            <button type="button" onClick={submit} disabled={busy || preview.guests.length === 0}>
              <Icon name="upload" />{' '}
              {busy ? 'Importing...' : `Import ${preview.guests.length} guests`}
            </button>
            <button type="button" className="secondary" onClick={() => setPreview(null)}>
              <Icon name="xCircle" /> Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
