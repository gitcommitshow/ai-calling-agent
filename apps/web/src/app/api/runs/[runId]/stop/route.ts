/**
 * Stop a run. The server hangs up the call that is up and dials nobody else, so
 * this is how the organizer ends a run early.
 */
import { NextResponse } from 'next/server';
import { ServerApiError, stopRun } from '../../../../../lib/server-api';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  try {
    const run = await stopRun(runId);
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
