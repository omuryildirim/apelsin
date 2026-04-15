import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { MEDIA_BUCKET } from "./shared/db";
import { ok, err, corsHeaders } from "./shared/utils";
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

  // ── GET /api/media/{key+} ───────────────────────────────────────────────
  if (method === "GET" && rawPath.startsWith("/api/media/")) {
    const key = rawPath.replace("/api/media/", "");
    if (!key) return err("key is required");

    // Access control: chat media keys are "chat-media/{chatId}/{id}"
    // chatId is "email1__email2" — verify the requester is a participant
    if (key.startsWith("chat-media/")) {
      const chatId = key.split("/")[1];
      if (chatId) {
        const participants = chatId.split("__");
        if (!participants.includes(user.email)) {
          return err("Access denied", 403);
        }
      }
    }

    try {
      const response = await s3.send(new GetObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: key,
      }));

      const body = await response.Body?.transformToByteArray();
      if (!body) return err("File not found", 404);

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders(),
          "Content-Type": response.ContentType ?? "application/octet-stream",
          "Cache-Control": "private, max-age=86400",
        },
        body: Buffer.from(body).toString("base64"),
        isBase64Encoded: true,
      };
    } catch {
      return err("File not found", 404);
    }
  }

  // ── POST /api/upload-url ─────────────────────────────────────────────────
  if (method === "POST" && rawPath === "/api/upload-url") {
    const body = JSON.parse(event.body ?? "{}");
    const chatId = (typeof body.chatId === "string" ? body.chatId : "").trim().toLowerCase();
    const contentType = (typeof body.contentType === "string" ? body.contentType : "image/webp");
    if (!chatId) return err("chatId is required");

    // Verify the requester is a participant in this chat
    const participants = chatId.split("__");
    if (!participants.includes(user.email)) {
      return err("Access denied", 403);
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = `chat-media/${chatId}/${id}`;

    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      ContentType: contentType,
    }), { expiresIn: 300 });

    return ok({ uploadUrl, readUrl: mediaPath(key) });
  }

  return err("Not found", 404);
};
