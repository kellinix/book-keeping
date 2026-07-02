import { NextResponse } from 'next/server';
import { getUserIdFromAuthHeader } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const user_id = await getUserIdFromAuthHeader(authHeader);
    if (!user_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file') as unknown as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const contentType = file.type || 'application/octet-stream';
    if (!SUPPORTED_IMAGE_TYPES.includes(contentType)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const timestamp = Date.now();
    const ext = file.name?.split('.').pop() ?? 'bin';
    const key = `receipts/${user_id}/${timestamp}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage.from('uploads').upload(key, buffer, { contentType, upsert: false });
    if (uploadErr) {
      // eslint-disable-next-line no-console
      console.error('Storage upload error', uploadErr);
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: upRow, error: upRowErr } = await supabaseAdmin.from('uploads').insert({ user_id, key, name: file.name || 'receipt', size: buffer.length, content_type: contentType }).select().single();
    if (upRowErr) {
      // eslint-disable-next-line no-console
      console.error('Uploads table insert error', upRowErr);
    }

    return NextResponse.json({
      success: true,
      key,
      upload: upRow ?? null,
      ocrText: null,
      message: 'Receipt stored. OCR extraction is planned for a later phase; enter fields manually for now.'
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('OCR endpoint error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
