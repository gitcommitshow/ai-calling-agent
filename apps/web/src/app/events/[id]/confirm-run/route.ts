/**
 * Starts a run the organizer already confirmed twice, then returns to the event.
 * Used by the full-page outside-hours gate, which must work without client JS.
 */
import { NextResponse } from 'next/server';
import { zonedInputToIso } from '../../../../lib/time';
import {
  callGuest,
  getCampaign,
  loadSettings,
  ServerApiError,
  startRun,
} from '../../../../lib/server-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const back = new URL(`/events/${id}`, request.url);
  try {
    const form = await request.formData();
    const campaignId = String(form.get('campaignId') ?? '');
    const guestId = String(form.get('guestId') ?? '');
    const startsAtRaw = String(form.get('startsAt') ?? '');
    if (!campaignId) {
      back.searchParams.set('callError', 'Missing campaign.');
      return NextResponse.redirect(back, 303);
    }

    const { callingHoursMode } = await loadSettings();
    if (callingHoursMode === 'strict') {
      back.searchParams.set(
        'callError',
        'Calling hours are strict on this server (STRICT_CALLING_HOURS). Unset that variable and restart the server if you really need to call outside those hours.',
      );
      return NextResponse.redirect(back, 303);
    }

    const campaign = await getCampaign(campaignId);
    const startsAt = startsAtRaw
      ? startsAtRaw.endsWith('Z')
        ? startsAtRaw
        : zonedInputToIso(startsAtRaw, campaign.callingWindow.timezone)
      : undefined;

    if (guestId) {
      await callGuest(campaignId, guestId, { waiveCallingWindow: true });
    } else {
      await startRun(campaignId, { startsAt, waiveCallingWindow: true });
    }
    return NextResponse.redirect(back, 303);
  } catch (error) {
    const message = error instanceof ServerApiError ? error.message : (error as Error).message;
    back.searchParams.set('callError', message || 'could not start the call');
    return NextResponse.redirect(back, 303);
  }
}
