import { QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import * as webpush from "web-push";
import { db, Tables } from "./db";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

/** Send a push notification to a user. */
export const sendPush = async (
  toEmail: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  urgency: "very-low" | "low" | "normal" | "high" = "high",
  ttl = 30,
) => {
  const { Items = [] } = await db.send(new QueryCommand({
    TableName: Tables.pushSubscriptions,
    KeyConditionExpression: "email = :e",
    ExpressionAttributeValues: { ":e": toEmail },
  }));

  const payload = JSON.stringify({ title, body, data });

  await Promise.allSettled(
    Items.map(async (item) => {
      try {
        const sub = JSON.parse(item.subscription as string);
        await webpush.sendNotification(sub, payload, { urgency, TTL: ttl });
      } catch (e: unknown) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await db.send(new DeleteCommand({
            TableName: Tables.pushSubscriptions,
            Key: { email: toEmail, deviceId: item.deviceId as string },
          }));
        }
      }
    }),
  );
};
