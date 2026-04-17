import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, Tables } from "./shared/db";
import { ok, err } from "./shared/utils";
import { authenticate, isAuthError, authorizeContactAccess } from "./shared/auth";
import { verifyOrigin } from "./shared/origin";
import { sendPush } from "./shared/push";
import { getDisplayName } from "./shared/queries";
import { relayToConnections, cancelCall } from "./shared/call";

const CALL_TTL_SECONDS = 60;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const { method, path: rawPath } = event.requestContext.http;

  if (method === "OPTIONS") return ok({});

  const originErr = verifyOrigin(event);
  if (originErr) return originErr;

  const user = await authenticate(event);
  if (isAuthError(user)) return user;

  // ── POST /api/call/request ──────────────────────────────────────────────
  if (method === "POST" && rawPath === "/api/call/request") {
    const body = JSON.parse(event.body ?? "{}");
    const to = (typeof body.to === "string" ? body.to : "").trim().toLowerCase();
    if (!to) return err("to is required");

    const contactErr = await authorizeContactAccess(user.email, to);
    if (contactErr) return contactErr;

    // Store call record
    await db.send(new PutCommand({
      TableName: Tables.calls,
      Item: {
        caller: user.email,
        callee: to,
        createdAt: Date.now(),
        ttl: Math.floor(Date.now() / 1000) + CALL_TTL_SECONDS,
      },
    }));

    // Relay call-request via WebSocket + send high-urgency push
    const displayName = await getDisplayName(user.email);
    await Promise.all([
      relayToConnections(to, {
        type: "call",
        callType: "call-request",
        from: user.email,
        data: {},
      }),
      sendPush(to, displayName, "Incoming call", {
        type: "call",
        from: user.email,
        caller: user.email,
      }),
    ]);

    return ok({ message: "Call request sent" });
  }

  // ── POST /api/call/cancel ───────────────────────────────────────────────
  if (method === "POST" && rawPath === "/api/call/cancel") {
    const body = JSON.parse(event.body ?? "{}");
    const to = (typeof body.to === "string" ? body.to : "").trim().toLowerCase();

    if (!to) return err("to is required");

    const contactErr = await authorizeContactAccess(user.email, to);
    if (contactErr) return contactErr;

    await cancelCall(user.email);

    return ok({ message: "Call cancelled" });
  }

  return err("Not found", 404);
};
