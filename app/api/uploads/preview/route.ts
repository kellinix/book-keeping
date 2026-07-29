import { NextResponse } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { getUserFromAuthHeader } from "../../../../lib/auth";
import { ensureProfileForUser } from "../../../../lib/profiles";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const ALLOWED_TYPES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await getUserFromAuthHeader(req.headers.get("authorization"));
  const userId = user?.id ?? null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureProfileForUser(user);
  const form = await req.formData();
  const file = form.get("file") as unknown as File;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File is too large. Maximum size is 25 MB." }, { status: 413 });

  const name = file.name || "upload";
  const lowerName = name.toLowerCase();
  const validExtension = lowerName.endsWith(".csv") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
  if (!validExtension && file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type. Upload CSV or XLSX for the MVP." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let upload: { id?: string; key?: string } | null = null;

  if (userId) {
    const key = `bank-statements/${userId}/${Date.now()}-${name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const { error: storageError } = await supabaseAdmin.storage.from("uploads").upload(key, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (!storageError) {
      const { data: uploadRow } = await supabaseAdmin
        .from("uploads")
        .insert({ content_type: file.type, key, name, size: file.size, user_id: userId })
        .select("id,key")
        .single();
      upload = uploadRow;
    }
  }

  if (lowerName.endsWith(".csv") || file.type === "text/csv") {
    const text = buffer.toString("utf-8");
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) return NextResponse.json({ error: parsed.errors[0]?.message ?? "Unable to parse CSV" }, { status: 400 });
    return NextResponse.json({ rows: parsed.data.slice(0, 1000), fields: parsed.meta.fields ?? [], upload });
  }

  // Try XLSX
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(worksheet, { raw: false });
    return NextResponse.json({ rows: json.slice(0, 1000), fields: Object.keys(json[0] ?? {}), upload });
  } catch (err) {
    return NextResponse.json({ error: "Unable to parse file" }, { status: 400 });
  }
}
