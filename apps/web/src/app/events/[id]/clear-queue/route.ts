/**
 * Empties a saved queue that is waiting to be called, then returns to the event.
 * A normal form post, so Remove still works when client scripts have not attached.
 */
import { NextResponse } from 'next/server';
import { LIVE_RUN_STATUSES } from '../../../../domain/types';
import { listRuns, ServerApiError, updateCampaign } from '../../../../lib/server-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const back = new URL(`/events/${id}`, request.url);
  try {
    const form = await request.formData();
    const campaignId = String(form.get('campaignId') ?? '');
    if (!campaignId) {
      back.searchParams.set('callError', 'Missing campaign.');
      return NextResponse.redirect(back, 303);
    }

    const runs = await listRuns(id);
    const busy = runs.some(
      (run) =>
        run.campaignId === campaignId &&
        (run.status === 'scheduled' || LIVE_RUN_STATUSES.includes(run.status)),
    );
    if (busy) {
      back.searchParams.set('callError', 'Stop this campaign before removing its queue.');
      return NextResponse.redirect(back, 303);
    }

    await updateCampaign(campaignId, { queue: [] });
    return NextResponse.redirect(back, 303);
  } catch (error) {
    const message = error instanceof ServerApiError ? error.message : (error as Error).message;
    back.searchParams.set('callError', message || 'could not remove the queue');
    return NextResponse.redirect(back, 303);
  }
}
