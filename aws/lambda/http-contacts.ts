import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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

  // ── POST /api/contacts — send connection request ────────────────────────
  if (method === "POST" && rawPath === "/api/contacts") {
    const body = JSON.parse(event.body ?? "{}");
    const targetEmail = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();

    if (!targetEmail) return err("Email is required");
    if (targetEmail === user.email) return err("Cannot add yourself");

    // Check target exists
    const { Item: targetUser } = await db.send(new GetCommand({
      TableName: Tables.users,
      Key: { email: targetEmail },
    }));
    if (!targetUser) return err("User not found", 404);

    // Check if already connected or pending
    const { Item: existing } = await db.send(new GetCommand({
      TableName: Tables.contacts,
      Key: { email: user.email, contactEmail: targetEmail },
    }));
    if (existing?.status === "accepted") return err("Already connected", 409);
    if (existing?.status === "pending") return err("Request already sent", 409);

    // Check if the other person already sent us a request — auto-accept
    const { Item: reverse } = await db.send(new GetCommand({
      TableName: Tables.contacts,
      Key: { email: targetEmail, contactEmail: user.email },
    }));

    if (reverse?.status === "pending") {
      // Auto-accept both directions
      const now = Date.now();
      await db.send(new UpdateCommand({
        TableName: Tables.contacts,
        Key: { email: targetEmail, contactEmail: user.email },
        UpdateExpression: "SET #s = :s, #u = :u",
        ExpressionAttributeNames: { "#s": "status", "#u": "updatedAt" },
        ExpressionAttributeValues: { ":s": "accepted", ":u": now },
      }));
      await db.send(new PutCommand({
        TableName: Tables.contacts,
        Item: {
          email: user.email,
          contactEmail: targetEmail,
          status: "accepted",
          requestedAt: now,
          updatedAt: now,
        },
      }));
      return ok({ message: "Connected — they had already requested you", status: "accepted" }, 201);
    }

    // Create pending request
    await db.send(new PutCommand({
      TableName: Tables.contacts,
      Item: {
        email: user.email,
        contactEmail: targetEmail,
        status: "pending",
        requestedAt: Date.now(),
        updatedAt: Date.now(),
      },
    }));

    return ok({ message: "Connection request sent", status: "pending" }, 201);
  }

  // ── GET /api/contacts — list accepted connections ───────────────────────
  if (method === "GET" && rawPath === "/api/contacts") {
    // Accepted contacts are written bidirectionally, so querying one direction is sufficient.
    const { Items = [] } = await db.send(new QueryCommand({
      TableName: Tables.contacts,
      KeyConditionExpression: "email = :e",
      FilterExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":e": user.email, ":s": "accepted" },
    }));

    const contacts = await Promise.all(
      Items.map(async (item) => {
        const { Item } = await db.send(new GetCommand({
          TableName: Tables.users,
          Key: { email: item.contactEmail as string },
        }));
        if (!Item) return null;
        return {
          userId: Item.userId,
          email: Item.email,
          displayName: Item.displayName,
          photoUrl: Item.photoUrl,
        };
      }),
    );

    return ok(contacts.filter(Boolean));
  }

  // ── GET /api/contacts/pending — incoming pending requests ───────────────
  if (method === "GET" && rawPath === "/api/contacts/pending") {
    const { Items: pending = [] } = await db.send(new QueryCommand({
      TableName: Tables.contacts,
      IndexName: "contactEmail-index",
      KeyConditionExpression: "contactEmail = :e",
      FilterExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":e": user.email, ":s": "pending" },
    }));

    const requests = await Promise.all(
      pending.map(async (item) => {
        const { Item } = await db.send(new GetCommand({
          TableName: Tables.users,
          Key: { email: item.email as string },
        }));
        return {
          email: item.email,
          displayName: Item?.displayName,
          photoUrl: Item?.photoUrl,
          requestedAt: item.requestedAt,
        };
      }),
    );

    return ok(requests);
  }

  // ── PUT /api/contacts/{email} — accept or decline ──────────────────────
  if (method === "PUT" && rawPath.startsWith("/api/contacts/")) {
    const requesterEmail = decodeURIComponent(event.pathParameters?.email ?? "").trim().toLowerCase();
    if (!requesterEmail) return err("Email is required");

    const body = JSON.parse(event.body ?? "{}");
    const action = body.action as string;
    if (action !== "accept" && action !== "decline") return err("action must be 'accept' or 'decline'");

    // Verify pending request exists
    const { Item: request } = await db.send(new GetCommand({
      TableName: Tables.contacts,
      Key: { email: requesterEmail, contactEmail: user.email },
    }));

    if (!request || request.status !== "pending") {
      return err("No pending request found", 404);
    }

    const now = Date.now();

    if (action === "accept") {
      // Update the requester's record
      await db.send(new UpdateCommand({
        TableName: Tables.contacts,
        Key: { email: requesterEmail, contactEmail: user.email },
        UpdateExpression: "SET #s = :s, #u = :u",
        ExpressionAttributeNames: { "#s": "status", "#u": "updatedAt" },
        ExpressionAttributeValues: { ":s": "accepted", ":u": now },
      }));

      // Create the reverse record
      await db.send(new PutCommand({
        TableName: Tables.contacts,
        Item: {
          email: user.email,
          contactEmail: requesterEmail,
          status: "accepted",
          requestedAt: now,
          updatedAt: now,
        },
      }));

      return ok({ message: "Connection accepted" });
    }

    // Decline — update status
    await db.send(new UpdateCommand({
      TableName: Tables.contacts,
      Key: { email: requesterEmail, contactEmail: user.email },
      UpdateExpression: "SET #s = :s, #u = :u",
      ExpressionAttributeNames: { "#s": "status", "#u": "updatedAt" },
      ExpressionAttributeValues: { ":s": "declined", ":u": now },
    }));

    return ok({ message: "Connection declined" });
  }

  return err("Not found", 404);
};
