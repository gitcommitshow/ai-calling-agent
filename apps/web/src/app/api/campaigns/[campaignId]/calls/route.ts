/**
 * Call one guest. Forwards the guest id to the server, which reads the number
 * from storage and decides. The answer is the run that is doing the calling, so
 * the browser can follow it the same way it follows a full run.
 */
import { NextResponse } from 'next/server';
import { callGuest, ServerApiError } from '../../../../../lib/server-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  try {
    const body = (await request.json()) as { guestId?: string };
    const run = await callGuest(campaignId, body.guestId ?? '');
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
