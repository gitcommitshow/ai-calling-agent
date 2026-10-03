/**
 * Full-page confirm for emptying a saved queue. Shown from the URL so the
 * question still blocks the page when client scripts have not attached.
 */
import Link from 'next/link';
import type { Campaign } from '../domain/types';

interface Props {
  eventId: string;
  campaign: Campaign;
}

export function RemoveQueueGate({ eventId, campaign }: Props) {
  return (
    <div className="outside-window-backdrop">
      <div className="outside-window-dialog" role="alertdialog" aria-modal="true">
        <h2>Remove this queue?</h2>
        <p>
          {campaign.name} will no longer be waiting to call. The campaign stays. Guests come off
          the list.
        </p>
        <div className="outside-window-actions">
          <Link href={`/events/${eventId}`} className="outside-window-cancel">
            Cancel
          </Link>
          <form action={`/events/${eventId}/clear-queue`} method="post">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <button type="submit" className="outside-window-danger">
              Remove
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
