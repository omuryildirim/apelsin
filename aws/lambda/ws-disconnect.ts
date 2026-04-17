import { DeleteCommand, GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { db, Tables, WS_ENDPOINT } from "./shared/db";
import { cancelCall as checkAndcancelCall } from "./shared/call";
import { getAcceptedContactEmails } from "./shared/queries";

let mgmt: ApiGatewayManagementApiClient | undefined;
function getMgmt() {
  if (!mgmt) mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });
  return mgmt;
}

export const handler = async (event: APIGatewayProxyWebsocketEventV2) => {
  const connId = event.requestContext.connectionId;

  // Look up the email before deleting
  const { Item } = await db.send(
    new GetCommand({
      TableName: Tables.connections,
      Key: { connectionId: connId },
    }),
  );

  await db.send(
    new DeleteCommand({
      TableName: Tables.connections,
      Key: { connectionId: connId },
    }),
  );

  if (!Item?.email) return { statusCode: 200, body: "Disconnected" };

  const email = Item.email as string;

  // Update lastSeen
  await db.send(
    new UpdateCommand({
      TableName: Tables.users,
      Key: { email },
      UpdateExpression: "SET #ls = :ls",
      ExpressionAttributeNames: { "#ls": "lastSeen" },
      ExpressionAttributeValues: { ":ls": Date.now() },
    }),
  ).catch(() => {});

  // ── Cancel active outgoing call if no remaining connections ──────────────
  const { Items: remainingConns = [] } = await db.send(new QueryCommand({
    TableName: Tables.connections,
    IndexName: "email-index",
    KeyConditionExpression: "email = :e",
    ExpressionAttributeValues: { ":e": email },
  }));

  if (remainingConns.length === 0) {
    await checkAndcancelCall(email);
  }

  const contactEmails = await getAcceptedContactEmails(email);

  const connResults = await Promise.all(
    contactEmails.map((e) =>
      db.send(new QueryCommand({
        TableName: Tables.connections,
        IndexName: "email-index",
        KeyConditionExpression: "email = :e",
        ExpressionAttributeValues: { ":e": e },
      })),
    ),
  );

  const contactConns = connResults.flatMap((r) => r.Items ?? []);

  const payload = Buffer.from(JSON.stringify({
    type: "presence",
    presenceType: "offline",
    from: email,
  }));

  await Promise.allSettled(
    contactConns.map(async (conn) => {
      try {
        await getMgmt().send(
          new PostToConnectionCommand({
            ConnectionId: conn.connectionId as string,
            Data: payload,
          }),
        );
      } catch {
        // stale — ignore
      }
    }),
  );

  return { statusCode: 200, body: "Disconnected" };
};
