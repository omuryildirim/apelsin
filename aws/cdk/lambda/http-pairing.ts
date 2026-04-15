import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
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

  // ── POST /api/pairing — create a new pairing session ────────────────────
  if (method === "POST" && rawPath === "/api/pairing") {
    const body = JSON.parse(event.body ?? "{}");
    if (!body.tempPublicKeyJwk) return err("tempPublicKeyJwk is required");

    const sessionId = uuidv4();

    await db.send(new PutCommand({
      TableName: Tables.pairing,
      Item: {
        sessionId,
        email: user.email,
        tempPublicKeyJwk: JSON.stringify(body.tempPublicKeyJwk),
        status: "waiting",
        ttl: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      },
    }));

    return ok({ sessionId }, 201);
  }

  // ── GET /api/pairing/{sessionId} — poll for completion ──────────────────
  if (method === "GET" && rawPath.startsWith("/api/pairing/")) {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) return err("sessionId is required");

    const { Item } = await db.send(new GetCommand({
      TableName: Tables.pairing,
      Key: { sessionId },
    }));

    if (!Item) return err("Pairing session not found or expired", 404);
    if (Item.email !== user.email) return err("Unauthorized", 403);

    if (Item.status === "completed") {
      return ok({
        status: "completed",
        encryptedKeyBlob: Item.encryptedKeyBlob,
      });
    }

    return ok({ status: "waiting" });
  }

  // ── POST /api/pairing/{sessionId} — deliver the encrypted key ───────────
  if (method === "POST" && rawPath.startsWith("/api/pairing/")) {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) return err("sessionId is required");

    const body = JSON.parse(event.body ?? "{}");
    if (!body.encryptedKeyBlob) return err("encryptedKeyBlob is required");

    const { Item } = await db.send(new GetCommand({
      TableName: Tables.pairing,
      Key: { sessionId },
    }));

    if (!Item) return err("Pairing session not found or expired", 404);
    if (Item.email !== user.email) return err("Unauthorized", 403);
    if (Item.status === "completed") return err("Session already completed", 409);

    await db.send(new UpdateCommand({
      TableName: Tables.pairing,
      Key: { sessionId },
      UpdateExpression: "SET #s = :s, #b = :b",
      ExpressionAttributeNames: { "#s": "status", "#b": "encryptedKeyBlob" },
      ExpressionAttributeValues: { ":s": "completed", ":b": body.encryptedKeyBlob },
    }));

    return ok({ success: true });
  }

  return err("Not found", 404);
};
