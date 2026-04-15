import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, Tables } from "./shared/db";
import { ok, err } from "./shared/utils";
import { authenticate, isAuthError } from "./shared/auth";
import { verifyOrigin } from "./shared/origin";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const { method, path: rawPath } = event.requestContext.http;

  if (method === "OPTIONS") return ok({});

  const originErr = verifyOrigin(event);
  if (originErr) return originErr;

  const user = await authenticate(event);
  if (isAuthError(user)) return user;

  const body = JSON.parse(event.body ?? "{}");

  // ── POST /api/push/subscribe ────────────────────────────────────────────
  if (rawPath.endsWith("/subscribe")) {
    const { subscription } = body;
    if (!subscription?.endpoint) return err("subscription with endpoint is required");

    await db.send(new PutCommand({
      TableName: Tables.pushSubscriptions,
      Item: {
        email: user.email,
        deviceId: user.deviceId,
        endpoint: subscription.endpoint,
        subscription: JSON.stringify(subscription),
        createdAt: Date.now(),
      },
    }));

    return ok({ message: "Subscribed" });
  }

  // ── POST /api/push/unsubscribe ──────────────────────────────────────────
  if (rawPath.endsWith("/unsubscribe")) {
    await db.send(new DeleteCommand({
      TableName: Tables.pushSubscriptions,
      Key: { email: user.email, deviceId: user.deviceId },
    }));

    return ok({ message: "Unsubscribed" });
  }

  return err("Not found", 404);
};
