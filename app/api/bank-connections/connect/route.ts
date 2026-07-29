import { NextResponse } from "next/server";
import { getUserIdFromAuthHeader } from "../../../../lib/auth";
import { authorizationUrl, createState, isTrueLayerConfigured } from "../../../../lib/truelayer";

export async function POST(req: Request) {
  const userId = await getUserIdFromAuthHeader(req.headers.get("authorization"));
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTrueLayerConfigured()) return NextResponse.json({ error: "TrueLayer sandbox credentials are not configured" }, { status: 503 });
  return NextResponse.json({ url: authorizationUrl(createState(userId)) });
}
