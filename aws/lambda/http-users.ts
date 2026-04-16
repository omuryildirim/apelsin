import { ScanCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

  // ── POST /api/users/public-key ───────────────────────────────────────────
  if (method === "POST" && rawPath === "/api/users/public-key") {
    const body = JSON.parse(event.body ?? "{}");
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    if (!email || !body.publicKeyJwk) return err("email and publicKeyJwk are required");

    const { Item } = await db.send(new GetCommand({ TableName: Tables.users, Key: { email } }));

    if (!Item) return err("User not found", 404);

    await db.send(
      new PutCommand({
        TableName: Tables.users,
        Item: { ...Item, publicKeyJwk: JSON.stringify(body.publicKeyJwk) },
      }),
    );

    return ok({ message: "Public key stored" });
  }

  // ── GET /api/users ───────────────────────────────────────────────────────
  if (method === "GET" && rawPath === "/api/users") {
    const excludeEmail = (event.queryStringParameters?.excludeEmail ?? "").trim().toLowerCase();
    const { Items = [] } = await db.send(new ScanCommand({ TableName: Tables.users }));
    const result = Items.filter((u) => u.email !== excludeEmail).map((u) => ({
      userId: u.userId,
      email: u.email,
      displayName: u.displayName,
      photoUrl: u.photoUrl,
    }));
    return ok(result);
  }

  // ── GET /api/users/public-key/{email} ────────────────────────────────────
  if (method === "GET" && rawPath.startsWith("/api/users/public-key/")) {
    const email = decodeURIComponent(event.pathParameters?.email ?? "").trim().toLowerCase();
    if (!email) return err("email is required");

    const { Item } = await db.send(new GetCommand({ TableName: Tables.users, Key: { email } }));

    if (!Item?.publicKeyJwk) return err("Public key not found", 404);

    return ok({ email, publicKeyJwk: JSON.parse(Item.publicKeyJwk as string) });
  }

  // ── GET /api/users/status/{email} ─────────────────────────────────────────
  if (method === "GET" && rawPath.startsWith("/api/users/status/")) {
    const email = decodeURIComponent(event.pathParameters?.email ?? "").trim().toLowerCase();
    if (!email) return err("email is required");

    // Check if user has any active WebSocket connections
    const { Items = [] } = await db.send(new QueryCommand({
      TableName: Tables.connections,
      IndexName: "email-index",
      KeyConditionExpression: "email = :e",
      ExpressionAttributeValues: { ":e": email },
      Limit: 1,
    }));

    const online = Items.length > 0;

    // Get lastSeen from users table
    let lastSeen: number | undefined;
    if (!online) {
      const { Item } = await db.send(new GetCommand({ TableName: Tables.users, Key: { email } }));
      lastSeen = Item?.lastSeen as number | undefined;
    }

    return ok({ email, online, lastSeen });
  }

  return err("Not found", 404);
};
