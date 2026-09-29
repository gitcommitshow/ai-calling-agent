/**
 * Hang up a live pipeline test. Forwards to the server.
 */
import { NextResponse } from 'next/server';
import { ServerApiError, stopTestCall } from '../../../../../lib/server-api';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const testCall = await stopTestCall(id);
    return NextResponse.json({ testCall });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
