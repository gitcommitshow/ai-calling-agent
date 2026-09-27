/**
 * Start a run over the campaign's saved queue. The server owns every decision
 * about who is dialed; this only forwards the request and its status.
 */
import { NextResponse } from 'next/server';
import { ServerApiError, startRun } from '../../../../../lib/server-api';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  try {
    const run = await startRun(campaignId);
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
