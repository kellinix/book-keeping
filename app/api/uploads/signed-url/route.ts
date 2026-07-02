import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { key, expires = 60 } = body || {};
    if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

    const authHeader = req.headers.get('authorization');
    const user_id = await getUserIdFromAuthHeader(authHeader);
    if (!user_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify the upload belongs to the authenticated user
    const { data: uploadRow, error: uploadErr } = await supabaseAdmin.from('uploads').select('id,user_id').eq('key', key).single();
    if (uploadErr || !uploadRow) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    if (uploadRow.user_id !== user_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const expiresIn = Math.min(Math.max(Number(expires) || 60, 1), 60 * 60 * 24 * 7); // clamp between 1s and 7 days
    const { data, error } = await supabaseAdmin.storage.from('uploads').createSignedUrl(key, expiresIn);
    if (error) return NextResponse.json({ error: error.message ?? 'Storage error' }, { status: 500 });

    return NextResponse.json({ signedUrl: data.signedUrl, expiresIn });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('Signed URL error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
