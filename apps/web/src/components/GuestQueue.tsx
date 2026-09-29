'use client';

/**
 * Guest list and call queue editor: filter, select, reorder, save. One card per
 * guest, so a long row of columns never has to fit on a phone. The queue is the
 * only set a campaign may dial, and each card says whether that guest is
 * eligible right now and what a call to them did.
 */
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { APPROVAL_STATUS_ICONS } from './status-icons';
import { defaultCampaign } from '../domain/default-campaign';
import {
  checkEligibility,
  countAttemptsByGuest,
  type Eligibility,
} from '../domain/eligibility';
import { buildQueue, filterGuests, moveInQueue, ticketNamesOf } from '../domain/filter-order';
import { formatIndianPhone } from '../domain/phone';
import {
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABELS,
  ATTEMPT_STATUS_LABELS,
  CALL_OUTCOME_LABELS,
  LIVE_RUN_STATUSES,
  type ApprovalStatus,
  type Attempt,
  type Campaign,
  type CampaignType,
  type Event,
  type Guest,
  type Run,
} from '../domain/types';

/** Sentinel for the queue dropdown's "add a campaign" row. Not a stored id. */
const ADD_CAMPAIGN = '__add_campaign__';

/**
 * How often a single-guest call is checked, and for how long, before the card
 * sends the organizer to the results page instead.
 */
const CALL_POLL_MS = 2500;
const CALL_POLL_LIMIT = 240;

interface Props {
  event: Event;
  guests: Guest[];
  campaigns: Campaign[];
  attempts: Attempt[];
  nowIso: string;
}

export function GuestQueue({ event, guests, campaigns, attempts, nowIso }: Props) {
  const router = useRouter();
  const initialCampaign = defaultCampaign(campaigns, event, new Date(nowIso));
  const [campaignId, setCampaignId] = useState(initialCampaign?.id ?? '');
  const [addedCampaigns, setAddedCampaigns] = useState<Campaign[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftPurpose, setDraftPurpose] = useState('');
  const [draftType, setDraftType] = useState<CampaignType>(
    new Date(nowIso) < new Date(event.startsAt) ? 'pre-event' : 'post-event',
  );
  const [statuses, setStatuses] = useState<ApprovalStatus[]>([]);
  const [ticketName, setTicketName] = useState('');
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<string[]>(initialCampaign?.queue ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [callingGuestId, setCallingGuestId] = useState<string | null>(null);
  const [callResults, setCallResults] = useState<Record<string, string>>({});
  /** Brief highlight on a card after Earlier/Later so the move is visible. */
  const [movedGuestId, setMovedGuestId] = useState<string | null>(null);

  const knownCampaigns = useMemo(() => {
    const byId = new Map(campaigns.map((item) => [item.id, item]));
    for (const extra of addedCampaigns) {
      if (!byId.has(extra.id)) byId.set(extra.id, extra);
    }
    return [...byId.values()];
  }, [addedCampaigns, campaigns]);

  const campaign = knownCampaigns.find((candidate) => candidate.id === campaignId);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const ticketNames = useMemo(() => ticketNamesOf(guests), [guests]);

  /**
   * Queued guests first, in queue order, so Earlier/Later moves the card as well
   * as the position badge. Unqueued guests keep their filtered order after them.
   */
  const visible = useMemo(() => {
    const filtered = filterGuests(guests, {
      statuses: statuses.length ? statuses : undefined,
      ticketNames: ticketName ? [ticketName] : undefined,
      search,
    });
    const position = new Map(queue.map((guestId, index) => [guestId, index]));
    return [...filtered].sort((a, b) => {
      const aPos = position.get(a.id);
      const bPos = position.get(b.id);
      if (aPos !== undefined && bPos !== undefined) return aPos - bPos;
      if (aPos !== undefined) return -1;
      if (bPos !== undefined) return 1;
      return 0;
    });
  }, [guests, statuses, ticketName, search, queue]);

  const eligibility = useMemo(() => {
    if (!campaign) return new Map<string, Eligibility>();
    const attemptsByGuest = countAttemptsByGuest(attempts, campaign.id);
    const withQueue = { ...campaign, queue };
    return new Map(
      guests.map((guest) => [
        guest.id,
        checkEligibility(guest, { event, campaign: withQueue, attemptsByGuest, now }),
      ]),
    );
  }, [attempts, campaign, event, guests, now, queue]);

  const queuePosition = useMemo(
    () => new Map(queue.map((guestId, index) => [guestId, index + 1])),
    [queue],
  );

  function toggleStatus(status: ApprovalStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }

  function toggleGuest(guestId: string) {
    setQueue((current) =>
      current.includes(guestId)
        ? current.filter((id) => id !== guestId)
        : buildQueue(current, [...current, guestId]),
    );
  }

  /** Reorder the queue and flash the card so the organizer sees the change. */
  function moveGuest(guestId: string, direction: -1 | 1) {
    setQueue((current) => moveInQueue(current, guestId, direction));
    setMovedGuestId(guestId);
    window.setTimeout(() => {
      setMovedGuestId((current) => (current === guestId ? null : current));
    }, 500);
  }

  function selectVisible(selected: boolean) {
    const visibleIds = visible.map((guest) => guest.id);
    setQueue((current) =>
      selected
        ? buildQueue(current, [...current, ...visibleIds])
        : current.filter((guestId) => !visibleIds.includes(guestId)),
    );
  }

  /**
   * Call one guest. The server owns the decision and reads the number from
   * storage, then runs the call as a run of one. This follows that run to the
   * end so the guest's card shows the outcome instead of just "started".
   */
  async function callNow(guest: Guest) {
    if (!campaign) return;
    setCallingGuestId(guest.id);
    setCallResults((current) => ({ ...current, [guest.id]: 'Starting the call...' }));

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/calls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ guestId: guest.id }),
      });
      const payload = (await response.json()) as { run?: Run; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? 'the call was refused');

      await followRun(payload.run.id, guest.id);
    } catch (callError) {
      setCallResults((current) => ({ ...current, [guest.id]: (callError as Error).message }));
    } finally {
      setCallingGuestId(null);
    }
  }

  /** Poll one run of one guest until it settles, reporting each step. */
  async function followRun(runId: string, guestId: string) {
    for (let tick = 0; tick < CALL_POLL_LIMIT; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, CALL_POLL_MS));

      const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
      const payload = (await response.json()) as {
        run?: Run;
        attempts?: Attempt[];
        error?: string;
      };
      if (!response.ok || !payload.run) throw new Error(payload.error ?? 'lost track of the call');

      const attempt = payload.attempts?.[0];
      const skip = payload.run.skipped.find((entry) => entry.guestId === guestId);
      const status = skip
        ? `Not called: ${skip.reason}`
        : attempt?.status === 'done'
          ? `${attempt.outcome ? CALL_OUTCOME_LABELS[attempt.outcome] : 'Finished'}${attempt.error ? `: ${attempt.error}` : ''}`
          : ATTEMPT_STATUS_LABELS[attempt?.status ?? 'dialing'];
      setCallResults((current) => ({ ...current, [guestId]: status }));

      if (!LIVE_RUN_STATUSES.includes(payload.run.status)) {
        router.refresh();
        return;
      }
    }

    throw new Error('the call is taking longer than expected, check the results page');
  }

  /** Create an extra campaign and switch the queue onto it. */
  async function createCampaign() {
    const name = draftName.trim();
    const purpose = draftPurpose.trim();
    if (!name) {
      setError('Give the campaign a name.');
      return;
    }
    if (!purpose) {
      setError('Say what this call is for.');
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/events/${event.id}/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type: draftType, purpose }),
      });
      const payload = (await response.json()) as { campaign?: Campaign; error?: string };
      if (!response.ok || !payload.campaign) {
        throw new Error(payload.error ?? 'could not add the campaign');
      }
      setAddedCampaigns((current) => [...current, payload.campaign!]);
      setCampaignId(payload.campaign.id);
      setQueue(payload.campaign.queue);
      setDraftName('');
      setDraftPurpose('');
      setMessage(`Added ${payload.campaign.name}. Its queue is empty until you save one.`);
      router.refresh();
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!campaign) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queue }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not save the queue');

      setMessage(`Saved ${queue.length} guests to ${campaign.name}.`);
      router.refresh();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (knownCampaigns.length === 0 && campaignId !== ADD_CAMPAIGN) {
    return (
      <p className="empty">
        This event has no campaigns yet.{' '}
        <button type="button" onClick={() => setCampaignId(ADD_CAMPAIGN)}>
          Add a custom campaign
        </button>
      </p>
    );
  }

  const queueDirty = campaign ? queue.join(',') !== campaign.queue.join(',') : false;
  const importedGuests = guests.filter((guest) => guest.origin !== 'manual');
  const manualGuests = guests.filter((guest) => guest.origin === 'manual');
  const importedVisible = visible.filter((guest) => guest.origin !== 'manual');
  const manualVisible = visible.filter((guest) => guest.origin === 'manual');

  /** One guest card. Shared by the imported list and the hand-added list. */
  function guestCard(guest: Guest) {
    const position = queuePosition.get(guest.id);
    const queued = position !== undefined;
    const state = eligibility.get(guest.id);
    const savedInQueue = campaign?.queue.includes(guest.id) ?? false;
    const callResult = callResults[guest.id];
    const callBlockedBy = !state?.eligible
      ? (state?.reason ?? 'pick a campaign')
      : !savedInQueue
        ? 'save the queue before calling this guest'
        : null;

    return (
      <article
        key={guest.id}
        className={['entity-card', queued ? 'selected' : '', movedGuestId === guest.id ? 'just-moved' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className="entity-card-head">
          <input
            type="checkbox"
            aria-label={`Queue ${guest.name}`}
            checked={queued}
            onChange={() => toggleGuest(guest.id)}
          />
          <div>
            <h3>{guest.name}</h3>
            <span className="chip">
              <Icon name={APPROVAL_STATUS_ICONS[guest.approvalStatus]} />
              {APPROVAL_STATUS_LABELS[guest.approvalStatus]}
            </span>
          </div>
          {queued ? (
            <span className="position-badge" title="Queue position">
              {position}
            </span>
          ) : null}
        </div>

        <div className="meta">
          <span className="meta-row">
            <Icon name="phone" />
            <span className="phone">{formatIndianPhone(guest.phone)}</span>
          </span>
          <span className="meta-row">
            <Icon name="mail" />
            <span className="truncate">{guest.email ?? 'no email'}</span>
          </span>
          <span className="meta-row">
            <Icon name="ticket" />
            <span className="truncate">{guest.ticketName ?? 'no ticket type'}</span>
          </span>
        </div>

        {!state?.eligible ? (
          <p className="status-line blocked">
            <Icon name="ban" />
            <span>{state?.reason ?? 'pick a campaign'}</span>
          </p>
        ) : savedInQueue ? (
          <p className="status-line ok">
            <Icon name="checkCircle" />
            <span>Eligible to call</span>
          </p>
        ) : (
          <p className="status-line">
            <Icon name="list" />
            <span>Eligible once the queue is saved</span>
          </p>
        )}

        {callResult ? (
          <p className="status-line">
            <Icon name="alert" />
            <span>{callResult}</span>
          </p>
        ) : null}

        <div className="entity-card-foot">
          <button
            type="button"
            className="tiny"
            disabled={callBlockedBy !== null || callingGuestId === guest.id}
            title={callBlockedBy ?? `Call ${guest.name} now`}
            onClick={() => callNow(guest)}
          >
            <Icon name="phone" />
            {callingGuestId === guest.id ? 'Calling...' : 'Call now'}
          </button>

          {queued ? (
            <span className="toolbar">
              <button
                type="button"
                className="secondary tiny"
                aria-label={`Move ${guest.name} earlier in the queue`}
                onClick={() => moveGuest(guest.id, -1)}
              >
                <Icon name="arrowUp" /> Earlier
              </button>
              <button
                type="button"
                className="secondary tiny"
                aria-label={`Move ${guest.name} later in the queue`}
                onClick={() => moveGuest(guest.id, 1)}
              >
                <Icon name="arrowDown" /> Later
              </button>
            </span>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="stack">
      <div className="grid">
        <div>
          <label htmlFor="campaign">Queue for campaign</label>
          <select
            id="campaign"
            value={campaignId}
            onChange={(changeEvent) => {
              const nextId = changeEvent.target.value;
              setCampaignId(nextId);
              setQueue(
                nextId === ADD_CAMPAIGN
                  ? []
                  : (knownCampaigns.find((item) => item.id === nextId)?.queue ?? []),
              );
              setMessage(null);
              setError(null);
            }}
          >
            {knownCampaigns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            <option value={ADD_CAMPAIGN}>Add a custom campaign...</option>
          </select>
          {campaign ? (
            <p className="small muted">
              <Link href={`/events/${event.id}/campaigns/${campaign.id}`}>Edit this campaign</Link>
            </p>
          ) : null}
        </div>
        {campaignId === ADD_CAMPAIGN ? null : (
          <>
        <div>
          <label htmlFor="ticket">Ticket type</label>
          <select
            id="ticket"
            value={ticketName}
            onChange={(changeEvent) => setTicketName(changeEvent.target.value)}
          >
            <option value="">All ticket types</option>
            {ticketNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search">Search name, email, or phone</label>
          <input
            id="search"
            value={search}
            placeholder="Any part of a name or number"
            onChange={(changeEvent) => setSearch(changeEvent.target.value)}
          />
        </div>
          </>
        )}
      </div>

      {campaignId === ADD_CAMPAIGN ? (
        <form
          className="stack"
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            void createCampaign();
          }}
        >
          <p className="small muted">
            A separate queue for this event. It keeps that type's master prompt. The purpose below is the only line added to it. The same timing rules still apply.
          </p>
          <div className="grid">
            <div>
              <label htmlFor="new-campaign-name">Campaign name</label>
              <input
                id="new-campaign-name"
                value={draftName}
                required
                maxLength={200}
                placeholder="Speakers reminder"
                onChange={(changeEvent) => setDraftName(changeEvent.target.value)}
              />
            </div>
            <div>
              <label htmlFor="new-campaign-type">When it can call</label>
              <select
                id="new-campaign-type"
                value={draftType}
                onChange={(changeEvent) => setDraftType(changeEvent.target.value as CampaignType)}
              >
                <option value="pre-event">Before the event starts</option>
                <option value="post-event">After the event ends</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="new-campaign-purpose">Purpose of this call</label>
            <textarea
              id="new-campaign-purpose"
              value={draftPurpose}
              required
              maxLength={500}
              rows={2}
              placeholder="Ask speakers to arrive 20 minutes early"
              onChange={(changeEvent) => setDraftPurpose(changeEvent.target.value)}
            />
          </div>
          <div className="toolbar">
            <button type="submit" disabled={busy}>
              <Icon name="check" /> {busy ? 'Adding...' : 'Add campaign'}
            </button>
          </div>
          {error ? (
            <p className="notice error small">
              <Icon name="alert" /> {error}
            </p>
          ) : null}
        </form>
      ) : (
        <>
      <div>
        <label>
          <Icon name="filter" /> Approval status
        </label>
        <div className="toolbar">
          {APPROVAL_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className="toggle"
              aria-pressed={statuses.includes(status)}
              onClick={() => toggleStatus(status)}
            >
              <Icon name={APPROVAL_STATUS_ICONS[status]} />
              {APPROVAL_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-split">
        <span className="small muted">
          <Icon name="users" /> {visible.length} of {guests.length} guests shown,{' '}
          {queue.length} in queue
          {queueDirty ? ' (unsaved)' : ''}
        </span>
        <div className="toolbar">
          <button type="button" className="secondary" onClick={() => selectVisible(true)}>
            <Icon name="check" /> Add shown
          </button>
          <button type="button" className="secondary" onClick={() => selectVisible(false)}>
            <Icon name="ban" /> Remove shown
          </button>
          <button type="button" onClick={save} disabled={busy || !queueDirty}>
            <Icon name="list" /> {busy ? 'Saving...' : `Save queue (${queue.length})`}
          </button>
        </div>
      </div>

      {message ? (
        <p className="notice small">
          <Icon name="checkCircle" /> {message}
        </p>
      ) : null}
      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}

      <div className="guest-groups">
        <section>
          <h3>Imported</h3>
          {importedGuests.length === 0 ? (
            <p className="empty">No imported guests yet. Import a Luma CSV above.</p>
          ) : importedVisible.length === 0 ? (
            <p className="empty">No imported guests match this filter.</p>
          ) : (
            <div className="card-grid">{importedVisible.map((guest) => guestCard(guest))}</div>
          )}
        </section>
        <section>
          <h3>Added by hand</h3>
          {manualGuests.length === 0 ? (
            <p className="empty">No guests added by hand yet.</p>
          ) : manualVisible.length === 0 ? (
            <p className="empty">No hand-added guests match this filter.</p>
          ) : (
            <div className="card-grid">{manualVisible.map((guest) => guestCard(guest))}</div>
          )}
        </section>
      </div>
        </>
      )}
    </div>
  );
}
