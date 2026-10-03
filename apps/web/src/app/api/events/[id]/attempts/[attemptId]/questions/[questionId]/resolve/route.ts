/**
 * Mark one unanswered question resolved. Forwards to the server, which keeps
 * the question on the attempt and drops it from the highlight.
 */
import { NextResponse } from 'next/server';
import { resolveOpenQuestion, ServerApiError } from '../../../../../../../../../lib/server-api';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; attemptId: string; questionId: string }> },
) {
  const { id, attemptId, questionId } = await params;
  try {
    const attempt = await resolveOpenQuestion(id, attemptId, questionId);
    return NextResponse.json({ attempt });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
