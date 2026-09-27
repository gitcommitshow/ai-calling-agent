/**
 * Run status for the browser, polled while a run is live. Returns the run plus
 * the attempts that belong to it, so the UI needs one request per tick.
 */
import { NextResponse } from 'next/server';
import { getRun, ServerApiError } from '../../../../lib/server-api';

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  try {
    return NextResponse.json(await getRun(runId));
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
