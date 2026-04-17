import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { db, Tables } from "./db";
import { err } from "./utils";

export interface AuthUser {
  email: string;
  userId: string;
  deviceToken: string;
  deviceId: string;
}

export async function authenticate(
  event: APIGatewayProxyEventV2,
): Promise<AuthUser | ReturnType<typeof err>> {
  const header = event.headers.authorization ?? event.headers.Authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const deviceId = event.headers["x-device-id"] ?? "";
  const email = (event.headers["x-user-email"] ?? "").trim().toLowerCase();

  if (!token) {
    return err("Missing or invalid Authorization header", 401);
  }

  if (!deviceId) {
    return err("Missing X-Device-Id header", 401);
  }

  if (!email) {
    return err("Missing X-User-Email header", 401);
  }

  const { Item } = await db.send(
    new GetCommand({
      TableName: Tables.deviceSessions,
      Key: { deviceToken: token },
    }),
  );

  if (!Item) {
    return err("Invalid or expired token", 401);
  }

  if (Item.deviceId !== deviceId) {
    return err("Device mismatch", 401);
  }

  if (Item.email !== email) {
    return err("Email mismatch", 401);
  }

  return {
    email: Item.email as string,
    userId: Item.userId as string,
    deviceToken: token,
    deviceId: Item.deviceId as string,
  };
}

export function isAuthError(
  result: AuthUser | ReturnType<typeof err>,
): result is ReturnType<typeof err> {
  return typeof result === "object" && result !== null && "statusCode" in result;
}

export const authorizeChatAccess = (chatId: string, email: string): ReturnType<typeof err> | null => {
  const participants = chatId.split("__");
  if (participants.length !== 2 || !participants.includes(email)) {
    return err("You are not a participant in this chat", 403);
  }
  return null;
};

export const authorizeOwnership = (resourceEmail: string, userEmail: string): ReturnType<typeof err> | null =>
  resourceEmail === userEmail ? null : err("You can only modify your own resources", 403);

export const authorizeContactAccess = async (email: string, targetEmail: string): Promise<ReturnType<typeof err> | null> => {
  const { Item } = await db.send(new GetCommand({
    TableName: Tables.contacts,
    Key: { email, contactEmail: targetEmail },
  }));
  if (Item?.status === "accepted") return null;
  return err("You are not connected with this user", 403);
};
