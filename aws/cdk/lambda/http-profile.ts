import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, Tables, MEDIA_BUCKET } from "./shared/db";
import { ok, err } from "./shared/utils";
import { authenticate, isAuthError } from "./shared/auth";
import { verifyOrigin } from "./shared/origin";

const s3 = new S3Client({});

const mediaPath = (key: string): string => `/api/media/${key}`;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const { method, path: rawPath } = event.requestContext.http;

  if (method === "OPTIONS") return ok({});

  const originErr = verifyOrigin(event);
  if (originErr) return originErr;

  const user = await authenticate(event);
  if (isAuthError(user)) return user;

  // ── GET /api/profile/{email} ─────────────────────────────────────────
  if (method === "GET" && rawPath.startsWith("/api/profile/")) {
    const email = decodeURIComponent(event.pathParameters?.email ?? "").trim().toLowerCase();
    if (!email) return err("email is required");

    const { Item } = await db.send(new GetCommand({ TableName: Tables.users, Key: { email } }));
    if (!Item) return err("User not found", 404);

    const photoUrl = Item.photoKey ? mediaPath(Item.photoKey as string) : undefined;

    return ok({
      email: Item.email,
      displayName: Item.displayName ?? Item.email,
      photoUrl,
    });
  }

  // ── PUT /api/profile ────────────────────────────────────────────────────
  if (method === "PUT" && rawPath === "/api/profile") {
    const body = JSON.parse(event.body ?? "{}");
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    if (!email) return err("email is required");

    const { Item } = await db.send(new GetCommand({ TableName: Tables.users, Key: { email } }));
    if (!Item) return err("User not found", 404);

    const updates: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    if (typeof body.displayName === "string") {
      updates.push("#dn = :dn");
      names["#dn"] = "displayName";
      values[":dn"] = body.displayName.trim();
    }

    if (updates.length === 0) return err("Nothing to update");

    await db.send(new UpdateCommand({
      TableName: Tables.users,
      Key: { email },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));

    return ok({ message: "Profile updated" });
  }

  // ── POST /api/profile/photo-url ─────────────────────────────────────────
  if (method === "POST" && rawPath === "/api/profile/photo-url") {
    const body = JSON.parse(event.body ?? "{}");
    const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
    const contentType = (typeof body.contentType === "string" ? body.contentType : "image/jpeg");
    if (!email) return err("email is required");

    const key = `profiles/${email}/photo`;

    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      ContentType: contentType,
    }), { expiresIn: 300 });

    const readUrl = mediaPath(key);

    await db.send(new UpdateCommand({
      TableName: Tables.users,
      Key: { email },
      UpdateExpression: "SET #pk = :pk, #pu = :pu",
      ExpressionAttributeNames: { "#pk": "photoKey", "#pu": "photoUrl" },
      ExpressionAttributeValues: { ":pk": key, ":pu": readUrl },
    }));

    return ok({ uploadUrl, readUrl });
  }

  return err("Not found", 404);
};
