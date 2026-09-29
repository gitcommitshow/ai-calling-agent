/**
 * Start a run over the campaign's saved queue, now or at a time the organizer
 * picked. The server owns every decision about who is dialed.
 */
import { NextResponse } from 'next/server';
import { ServerApiError, startRun } from '../../../../../lib/server-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { startsAt?: unknown };
  const startsAt = typeof payload.startsAt === 'string' ? payload.startsAt : undefined;
  try {
    const run = await startRun(campaignId, startsAt);
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
