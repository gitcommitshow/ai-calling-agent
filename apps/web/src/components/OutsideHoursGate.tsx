/**
 * Full-page confirmation for a dial outside calling hours. Rendered by the
 * server from the URL, so the warning still blocks the page when client
 * scripts have not attached.
 */
import Link from 'next/link';
import { Icon } from './Icon';
import type { CallingHoursMode } from '../domain/settings';
import type { Campaign } from '../domain/types';

interface Props {
  eventId: string;
  campaign: Campaign;
  /** 1 is the warning. 2 is the final confirm that posts the dial. */
  step: '1' | '2';
  guestId?: string;
  startsAt?: string;
  /** Strict mode refuses the dial. The second step is not offered. */
  callingHoursMode?: CallingHoursMode;
}

export function OutsideHoursGate({
  eventId,
  campaign,
  step,
  guestId,
  startsAt,
  callingHoursMode = 'soft',
}: Props) {
  const hours = `${campaign.callingWindow.start}-${campaign.callingWindow.end} ${campaign.callingWindow.timezone}`;
  const back = `/events/${eventId}`;
  const next = new URLSearchParams({ confirm: campaign.id, step: '2' });
  if (guestId) next.set('guest', guestId);
  if (startsAt) next.set('startsAt', startsAt);
  const strict = callingHoursMode === 'strict';
  const finalStep = !strict && step === '2';

  return (
    <div className="outside-window-backdrop">
      <div className="outside-window-dialog" role="alertdialog" aria-modal="true">
        <p className="outside-window-kicker">
          <Icon name="alert" /> Do not call yet
        </p>
        <h2>
          {strict ? 'Calling hours are strict' : finalStep ? 'Confirm the override' : 'Outside calling hours'}
        </h2>
        <p>
          {strict
            ? `This server will not dial ${campaign.name} outside ${hours}. Unset STRICT_CALLING_HOURS and restart the server if you really need to call outside those hours.`
            : finalStep
              ? `Last chance. You are about to dial ${campaign.name} outside ${hours}. This override is stored on the run.`
              : `Allowed hours are ${hours}. A call right now may disturb people. You must confirm twice to continue.`}
        </p>
        <div className="outside-window-actions">
          <Link href={back} className="outside-window-cancel">
            {strict ? 'Close' : 'Cancel'}
          </Link>
          {finalStep ? (
            <form action={`/events/${eventId}/confirm-run`} method="post">
              <input type="hidden" name="campaignId" value={campaign.id} />
              {guestId ? <input type="hidden" name="guestId" value={guestId} /> : null}
              {startsAt ? <input type="hidden" name="startsAt" value={startsAt} /> : null}
              <button type="submit" className="outside-window-danger">
                {startsAt ? 'Schedule anyway' : 'Call anyway'}
              </button>
            </form>
          ) : strict ? null : (
            <Link href={`${back}?${next.toString()}`} className="outside-window-next">
              I understand the risk
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
