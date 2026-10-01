/**
 * Set or clear one guest's attempt limit. Forwards to the server, which stores
 * the number on the campaign and treats null as "follow the campaign default".
 */
import { NextResponse } from 'next/server';
import { ServerApiError, setGuestRetryCap } from '../../../../../../../lib/server-api';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; guestId: string }> },
) {
  const { campaignId, guestId } = await params;
  try {
    const body = (await request.json()) as { retryCap?: number | null } | null;
    if (!body || typeof body !== 'object' || !('retryCap' in body)) {
      return NextResponse.json({ error: 'retryCap is required' }, { status: 400 });
    }
    const campaign = await setGuestRetryCap(campaignId, guestId, body.retryCap ?? null);
    return NextResponse.json({ campaign });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
