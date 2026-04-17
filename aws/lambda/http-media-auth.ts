import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, Tables } from "./shared/db";
import { ok } from "./shared/utils";
import { verifyOrigin } from "./shared/origin";
import { authorizeChatAccess } from "./shared/auth";

/**
 * POST /api/auth/verify-media
 *
 * Called by the Cloudflare media worker to verify:
 * 1. Token + deviceId match a valid device session
 * 2. The user is authorized to access the requested media key
 *
 * Body: { token, deviceId, mediaKey }
 * Returns: { authorized: true, email } or { authorized: false }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext.http.method === "OPTIONS") return ok({});

  const originErr = verifyOrigin(event);
  if (originErr) return originErr;

  const body = JSON.parse(event.body ?? "{}");
  const token = (typeof body.token === "string" ? body.token : "").trim();
  const deviceId = (typeof body.deviceId === "string" ? body.deviceId : "").trim();
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  const mediaKey = (typeof body.mediaKey === "string" ? body.mediaKey : "").trim();

  if (!token || !deviceId || !email || !mediaKey) {
    return ok({ authorized: false, reason: "Missing fields" });
  }

  // 1. Verify token + deviceId + email
  const { Item } = await db.send(new GetCommand({
    TableName: Tables.deviceSessions,
    Key: { deviceToken: token },
  }));

  if (!Item) {
    return ok({ authorized: false, reason: "Invalid token" });
  }

  if (Item.deviceId !== deviceId) {
    return ok({ authorized: false, reason: "Device mismatch" });
  }

  if (Item.email !== email) {
    return ok({ authorized: false, reason: "Email mismatch" });
  }

  // 2. Check media access
  // Profile photos (profiles/{email}/photo) — accessible to all authenticated users
  if (mediaKey.startsWith("profiles/")) {
    return ok({ authorized: true, email });
  }

  // Chat media (chat-media/{chatId}/{id}) — only participants
  if (mediaKey.startsWith("chat-media/")) {
    const chatId = mediaKey.split("/")[1];
    if (chatId && authorizeChatAccess(chatId, email)) {
      return ok({ authorized: false, reason: "Not a participant" });
    }
    return ok({ authorized: true, email });
  }

  // Unknown key pattern — deny by default
  return ok({ authorized: false, reason: "Unknown media type" });
};
