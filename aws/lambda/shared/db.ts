import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
export const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const Tables = {
  connections: process.env.CONNECTIONS_TABLE as string,
  messages: process.env.MESSAGES_TABLE as string,
  users: process.env.USERS_TABLE as string,
  signals: process.env.SIGNALS_TABLE as string,
  pushSubscriptions: process.env.PUSH_SUBSCRIPTIONS_TABLE as string,
  pairing: process.env.PAIRING_TABLE as string,
  contacts: process.env.CONTACTS_TABLE as string,
  deviceSessions: process.env.DEVICE_SESSIONS_TABLE as string,
  calls: process.env.CALLS_TABLE as string,
};

export const WS_ENDPOINT = process.env.WS_ENDPOINT as string;
export const MEDIA_BUCKET = process.env.MEDIA_BUCKET as string;
