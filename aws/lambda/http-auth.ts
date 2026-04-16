import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import * as bcrypt from "bcryptjs";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, Tables } from "./shared/db";
import { ok, err } from "./shared/utils";
import { authenticate, isAuthError } from "./shared/auth";
import { verifyOrigin } from "./shared/origin";

const SESSION_TTL_DAYS = 365;

function parseDeviceInfo(body: Record<string, unknown>): string {
  return typeof body.deviceInfo === "string" ? body.deviceInfo : "Unknown device";
}

async function createDeviceSession(
  email: string,
  userId: string,
  deviceInfo: string,
  deviceId: string,
): Promise<string> {
  const deviceToken = uuidv4();

  await db.send(new PutCommand({
    TableName: Tables.deviceSessions,
    Item: {
      deviceToken,
      email,
      userId,
      deviceInfo,
      deviceId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 86400,
    },
  }));

  return deviceToken;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const { method, path: rawPath } = event.requestContext.http;

  if (method === "OPTIONS") return ok({});

  const originErr = verifyOrigin(event);
  if (originErr) return originErr;

  // ── POST /api/auth/register ──────────────────────────────────────────────
  if (method === "POST" && rawPath.endsWith("/register")) {
    const body = JSON.parse(event.body ?? "{}");
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    const password = (typeof body.password === "string" ? body.password : "").trim();
    const displayName = (typeof body.displayName === "string" ? body.displayName : "").trim();

    const deviceId = (typeof body.deviceId === "string" ? body.deviceId : "").trim();
    if (!email || !password) return err("Email and password are required");
    if (!displayName) return err("Name is required");
    if (!deviceId) return err("deviceId is required");

    const existing = await db.send(new GetCommand({ TableName: Tables.users, Key: { email } }));
    if (existing.Item) return err("An account with this email already exists", 409);

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const user = {
      email,
      displayName,
      passwordHash,
      userId,
      publicKeyJwk: body.publicKeyJwk ? JSON.stringify(body.publicKeyJwk) : undefined,
    };

    await db.send(new PutCommand({ TableName: Tables.users, Item: user }));

    const deviceToken = await createDeviceSession(email, userId, parseDeviceInfo(body), deviceId);

    return ok({ message: "User registered successfully", userId, token: deviceToken, email, displayName }, 201);
  }

  // ── POST /api/auth/login ─────────────────────────────────────────────────
  if (method === "POST" && rawPath.endsWith("/login")) {
    const body = JSON.parse(event.body ?? "{}");
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    const password = (typeof body.password === "string" ? body.password : "").trim();

    const deviceId = (typeof body.deviceId === "string" ? body.deviceId : "").trim();
    if (!email || !password) return err("Email and password are required");
    if (!deviceId) return err("deviceId is required");

    const { Item } = await db.send(new GetCommand({ TableName: Tables.users, Key: { email } }));
    if (!Item) return err("Invalid email or password", 401);

    const valid = await bcrypt.compare(password, Item.passwordHash as string);
    if (!valid) return err("Invalid email or password", 401);

    const deviceToken = await createDeviceSession(
      email,
      Item.userId as string,
      parseDeviceInfo(body),
      deviceId,
    );

    return ok({
      message: "Authentication successful",
      token: deviceToken,
      userId: Item.userId,
      email,
      displayName: Item.displayName,
    });
  }

  // ── GET /api/auth/devices — list active devices ─────────────────────────
  if (method === "GET" && rawPath.endsWith("/devices")) {
    const user = await authenticate(event);
    if (isAuthError(user)) return user;

    const { Items = [] } = await db.send(new QueryCommand({
      TableName: Tables.deviceSessions,
      IndexName: "email-index",
      KeyConditionExpression: "email = :e",
      ExpressionAttributeValues: { ":e": user.email },
    }));

    const devices = Items.map((item) => ({
      deviceToken: item.deviceToken,
      deviceInfo: item.deviceInfo,
      createdAt: item.createdAt,
      lastActiveAt: item.lastActiveAt,
      isCurrent: item.deviceToken === user.deviceToken,
    }));

    return ok(devices);
  }

  // ── DELETE /api/auth/devices/{deviceToken} — revoke a device ────────────
  if (method === "DELETE" && rawPath.startsWith("/api/auth/devices/")) {
    const user = await authenticate(event);
    if (isAuthError(user)) return user;

    const targetToken = decodeURIComponent(event.pathParameters?.deviceToken ?? "");
    if (!targetToken) return err("deviceToken is required");

    // Verify the device belongs to this user
    const { Item } = await db.send(new GetCommand({
      TableName: Tables.deviceSessions,
      Key: { deviceToken: targetToken },
    }));

    if (!Item || Item.email !== user.email) return err("Device not found", 404);

    // Delete device session + its push subscription
    await Promise.all([
      db.send(new DeleteCommand({
        TableName: Tables.deviceSessions,
        Key: { deviceToken: targetToken },
      })),
      db.send(new DeleteCommand({
        TableName: Tables.pushSubscriptions,
        Key: { email: user.email, deviceId: Item.deviceId as string },
      })),
    ]);

    return ok({ message: "Device revoked" });
  }

  return err("Not found", 404);
};
