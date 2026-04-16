import { QueryCommand, GetCommand, PutCommand, ScanCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { v4 as uuidv4 } from "uuid";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, Tables, WS_ENDPOINT } from "./shared/db";
import { normalizeChatId, messageSortKey, ok, err } from "./shared/utils";
import { authenticate, isAuthError, authorizeChatAccess, authorizeOwnership } from "./shared/auth";
import { verifyOrigin } from "./shared/origin";
import { sendPush } from "./shared/push";
import { getDisplayName } from "./shared/queries";
import type { Message } from "./shared/types";

let mgmt: ApiGatewayManagementApiClient | undefined;

function getMgmt() {
  if (!mgmt) mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });
  return mgmt;
}

async function fanOut(message: Message) {
  // Only send to connections belonging to chat participants
  const participants = message.chatId.split("__");
  const connResults = await Promise.all(
    participants.map((email) =>
      db.send(new QueryCommand({
        TableName: Tables.connections,
        IndexName: "email-index",
        KeyConditionExpression: "email = :e",
        ExpressionAttributeValues: { ":e": email },
      })),
    ),
  );

  const conns = connResults.flatMap((r) => r.Items ?? []);

  const { type: messageType, ...messageRest } = message;
  const notification = Buffer.from(
    JSON.stringify({ type: "notification", messageType, ...messageRest }),
  );

  await Promise.allSettled(
    conns.map(async (conn) => {
      try {
        await getMgmt().send(
          new PostToConnectionCommand({ ConnectionId: conn.connectionId as string, Data: notification }),
        );
      } catch (e: unknown) {
        const statusCode = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (statusCode === 410) {
          await db.send(
            new DeleteCommand({ TableName: Tables.connections, Key: { connectionId: conn.connectionId } }),
          );
        }
      }
    }),
  );
}

async function sendPushNotifications(message: Message) {
  if (!message.to) return;

  const displayName = await getDisplayName(message.author);
  const body = message.type === "image" ? "Sent a photo" : message.type === "audio" ? "Voice message" : "New message";

  await sendPush(message.to, displayName, body, {
    chatId: message.chatId,
    author: message.author,
    encryptedText: message.type === "text" ? message.text : undefined,
  });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;

  if (method === "OPTIONS") return ok({});

  const originErr = verifyOrigin(event);
  if (originErr) return originErr;

  const user = await authenticate(event);
  if (isAuthError(user)) return user;

  // ── GET /api/messages ────────────────────────────────────────────────────
  if (method === "GET") {
    const chatId = event.queryStringParameters?.chatId;
    const since = event.queryStringParameters?.since;

    if (!chatId) return err("chatId is required");

    const normalizedChatId = normalizeChatId(chatId);

    const accessErr = authorizeChatAccess(normalizedChatId, user.email);
    if (accessErr) return accessErr;

    const { Items = [] } = await db.send(
      new QueryCommand({
        TableName: Tables.messages,
        KeyConditionExpression: since
          ? "chatId = :chatId AND sk > :sk"
          : "chatId = :chatId",
        ExpressionAttributeValues: since
          ? { ":chatId": normalizedChatId, ":sk": messageSortKey(Number(since), "") }
          : { ":chatId": normalizedChatId },
        ScanIndexForward: true,
        Limit: 500,
      }),
    );

    const messages = Items.map(({ sk, ttl, ...msg }) => msg);
    return ok(messages);
  }

  // ── POST /api/messages ───────────────────────────────────────────────────
  if (method === "POST") {
    const raw = JSON.parse(event.body ?? "{}");
    const author = typeof raw.author === "string" ? raw.author.trim().toLowerCase() : "";
    const chatId = typeof raw.chatId === "string" ? normalizeChatId(raw.chatId) : "";

    if (!author || !chatId || !raw.type) return err("Missing required fields");

    const ownershipErr = authorizeOwnership(author, user.email);
    if (ownershipErr) return ownershipErr;

    const accessErr = authorizeChatAccess(chatId, user.email);
    if (accessErr) return accessErr;

    const message: Message = {
      id: uuidv4(),
      chatId,
      author,
      to: typeof raw.to === "string" ? raw.to.trim().toLowerCase() : undefined,
      type: raw.type,
      text: raw.text,
      imageUrl: raw.imageUrl,
      audioUrl: raw.audioUrl,
      replyTo: raw.replyTo?.id && raw.replyTo?.author
        ? { id: raw.replyTo.id, author: raw.replyTo.author, text: typeof raw.replyTo.text === "string" ? raw.replyTo.text.slice(0, 100) : undefined }
        : undefined,
      timestamp: Date.now(),
    };

    await db.send(
      new PutCommand({
        TableName: Tables.messages,
        Item: {
          ...message,
          sk: messageSortKey(message.timestamp, message.id),
          // Can be activated if you don't want to keep message history server side
          // The con will be with current approach we will not be able to recover
          // chat history in new devices or if user logs out or if the indexedDB gets cleared
          // ttl: Math.floor(Date.now() / 1000) + 604800, // 7 days
        },
      }),
    );

    await fanOut(message);
    await sendPushNotifications(message);

    return ok(message, 201);
  }

  // ── PUT /api/messages/reactions ──────────────────────────────────────────
  if (method === "PUT") {
    const raw = JSON.parse(event.body ?? "{}");
    const chatId = typeof raw.chatId === "string" ? normalizeChatId(raw.chatId) : "";
    const sk = typeof raw.sk === "string" ? raw.sk : "";
    const emoji = typeof raw.emoji === "string" ? raw.emoji : "";

    if (!chatId || !sk || !emoji) return err("chatId, sk, and emoji are required");

    const accessErr = authorizeChatAccess(chatId, user.email);
    if (accessErr) return accessErr;

    // Read current message
    const { Item } = await db.send(new GetCommand({
      TableName: Tables.messages,
      Key: { chatId, sk },
    }));
    if (!Item) return err("Message not found", 404);

    const reactions: Record<string, string[]> = (Item.reactions as Record<string, string[]>) ?? {};

    // Remove user from all other emojis first (one reaction per user)
    for (const [key, users] of Object.entries(reactions)) {
      reactions[key] = users.filter((u) => u !== user.email);
      if (reactions[key]!.length === 0) delete reactions[key];
    }

    // Toggle: if user already has this emoji, removal above handled it. Otherwise add.
    const existing = (Item.reactions as Record<string, string[]>)?.[emoji] ?? [];
    if (!existing.includes(user.email)) {
      if (!reactions[emoji]) reactions[emoji] = [];
      reactions[emoji]!.push(user.email);
    }

    // Write back
    await db.send(new UpdateCommand({
      TableName: Tables.messages,
      Key: { chatId, sk },
      UpdateExpression: "SET #r = :r",
      ExpressionAttributeNames: { "#r": "reactions" },
      ExpressionAttributeValues: { ":r": reactions },
    }));

    // Broadcast reaction update to chat participants only
    const reactionPayload = { type: "reaction", chatId, messageId: Item.id, reactions };
    const reactionParticipants = chatId.split("__");
    const connResults2 = await Promise.all(
      reactionParticipants.map((e: string) =>
        db.send(new QueryCommand({
          TableName: Tables.connections,
          IndexName: "email-index",
          KeyConditionExpression: "email = :e",
          ExpressionAttributeValues: { ":e": e },
        })),
      ),
    );
    const conns = connResults2.flatMap((r) => r.Items ?? []);
    const data = Buffer.from(JSON.stringify(reactionPayload));
    await Promise.allSettled(
      conns.map(async (conn) => {
        try {
          await getMgmt().send(
            new PostToConnectionCommand({ ConnectionId: conn.connectionId as string, Data: data }),
          );
        } catch {
          // stale
        }
      }),
    );

    return ok({ messageId: Item.id, reactions });
  }

  return err("Method not allowed", 405);
};
