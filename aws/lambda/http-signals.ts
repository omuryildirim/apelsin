import { QueryCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, Tables } from "./shared/db";
import { messageSortKey, ok, err } from "./shared/utils";
import { authenticate, isAuthError } from "./shared/auth";
import { verifyOrigin } from "./shared/origin";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const { method } = event.requestContext.http;

  if (method === "OPTIONS") return ok({});

  const originErr = verifyOrigin(event);
  if (originErr) return originErr;

  const user = await authenticate(event);
  if (isAuthError(user)) return user;

  // ── POST /api/signal ─────────────────────────────────────────────────────
  if (method === "POST") {
    const body = JSON.parse(event.body ?? "{}");
    if (!body.to || !body.from || !body.type) return err("Missing required fields");

    const ts = Date.now();
    await db.send(
      new PutCommand({
        TableName: Tables.signals,
        Item: {
          to: body.to,
          sk: messageSortKey(ts, uuidv4()),
          from: body.from,
          type: body.type,
          data: body.data ?? {},
          timestamp: ts,
          ttl: Math.floor(ts / 1000) + 300,
        },
      }),
    );
    return ok({ message: "Signal sent" }, 201);
  }

  // ── GET /api/signal/{peerId} ─────────────────────────────────────────────
  if (method === "GET") {
    const peerId = decodeURIComponent(event.pathParameters?.peerId ?? "");
    if (!peerId) return err("peerId is required");

    const { Items = [] } = await db.send(
      new QueryCommand({
        TableName: Tables.signals,
        KeyConditionExpression: "#t = :to",
        ExpressionAttributeNames: { "#t": "to" },
        ExpressionAttributeValues: { ":to": peerId },
        ScanIndexForward: true,
      }),
    );

    await Promise.allSettled(
      Items.map((item) =>
        db.send(new DeleteCommand({ TableName: Tables.signals, Key: { to: item.to, sk: item.sk } })),
      ),
    );

    const signals = Items.map(({ sk, ttl, ...s }) => s);
    return ok(signals);
  }

  return err("Method not allowed", 405);
};
