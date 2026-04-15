import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { db, Tables, WS_ENDPOINT } from "./shared/db";

let mgmt: ApiGatewayManagementApiClient | undefined;
function getMgmt() {
  if (!mgmt) mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });
  return mgmt;
}

const PRESENCE_TYPES = ["typing", "recording", "online", "offline", "idle"];
const CALL_TYPES = ["call-request", "call-accept", "call-reject", "call-end", "offer", "answer", "candidate"];

export const handler = async (event: APIGatewayProxyWebsocketEventV2) => {
  try {
    const connId = event.requestContext.connectionId;

    const body = JSON.parse(event.body ?? "{}") as {
      type?: string;
      to?: string;
      from?: string;
      data?: Record<string, unknown>;
    };

    if (!body.type || !body.to || !body.from) {
      return { statusCode: 400, body: "Missing fields" };
    }

    const isPresence = PRESENCE_TYPES.includes(body.type);
    const isCall = CALL_TYPES.includes(body.type);
    if (!isPresence && !isCall) {
      return { statusCode: 400, body: "Invalid type" };
    }

    // Verify the `from` field matches the authenticated connection's email
    const { Item: conn } = await db.send(
      new GetCommand({
        TableName: Tables.connections,
        Key: { connectionId: connId },
      }),
    );

    if (!conn || conn.email !== body.from) {
      return { statusCode: 403, body: "From email does not match authenticated user" };
    }

    // Find all connections belonging to the target user
    const { Items = [] } = await db.send(
      new QueryCommand({
        TableName: Tables.connections,
        IndexName: "email-index",
        KeyConditionExpression: "email = :e",
        ExpressionAttributeValues: { ":e": body.to },
      }),
    );

    // Build the relay payload
    const payload = isPresence
      ? Buffer.from(JSON.stringify({
          type: "presence",
          presenceType: body.type,
          from: body.from,
        }))
      : Buffer.from(JSON.stringify({
          type: "call",
          callType: body.type,
          from: body.from,
          data: body.data ?? {},
        }));

    await Promise.allSettled(
      Items.map(async (c) => {
        try {
          await getMgmt().send(
            new PostToConnectionCommand({
              ConnectionId: c.connectionId as string,
              Data: payload,
            }),
          );
        } catch {
          // stale connection — ignore
        }
      }),
    );
  } catch {
    // parse error — ignore
  }

  return { statusCode: 200, body: "OK" };
};
