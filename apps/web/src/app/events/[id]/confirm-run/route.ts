/**
 * Starts a run from the full-page confirm, then returns to the event.
 * Works without client JS. An outside-hours override is stored only when the
 * chosen instant is actually outside the window.
 */
import { NextResponse } from 'next/server';
import { isWithinCallingWindow, shouldWaiveCallingWindow } from '../../../../domain/eligibility';
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
    const campaign = await getCampaign(campaignId);
    const startsAt = startsAtRaw
      ? startsAtRaw.endsWith('Z')
        ? startsAtRaw
        : zonedInputToIso(startsAtRaw, campaign.callingWindow.timezone)
      : undefined;
    const at = startsAt ? new Date(startsAt) : new Date();
    if (Number.isNaN(at.getTime())) {
      back.searchParams.set('callError', 'choose a date and time');
      return NextResponse.redirect(back, 303);
    }
    if (
      callingHoursMode === 'strict' &&
      !isWithinCallingWindow(at, campaign.callingWindow)
    ) {
      back.searchParams.set(
        'callError',
        'Calling hours are strict on this server (STRICT_CALLING_HOURS). Unset that variable and restart the server if you really need to call outside those hours.',
      );
      return NextResponse.redirect(back, 303);
    }
    const waiveCallingWindow = shouldWaiveCallingWindow(
      at,
      campaign.callingWindow,
      callingHoursMode,
    );

    if (guestId) {
      await callGuest(campaignId, guestId, { waiveCallingWindow });
    } else {
      await startRun(campaignId, { startsAt, waiveCallingWindow });
    }
    return NextResponse.redirect(back, 303);
  } catch (error) {
    const message = error instanceof ServerApiError ? error.message : (error as Error).message;
    back.searchParams.set('callError', message || 'could not start the call');
    return NextResponse.redirect(back, 303);
  }
}
