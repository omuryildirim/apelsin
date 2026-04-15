import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { db, Tables, WS_ENDPOINT } from "./shared/db";

let mgmt: ApiGatewayManagementApiClient | undefined;
function getMgmt() {
  if (!mgmt) mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });
  return mgmt;
}

// The authorizer injects email into requestContext.authorizer
export const handler = async (event: {
  requestContext: {
    connectionId: string;
    authorizer?: { email?: string; userId?: string };
  };
}) => {
  const connId = event.requestContext.connectionId;
  const email = (event.requestContext.authorizer?.email ?? "").trim().toLowerCase();

  if (!email) {
    return { statusCode: 403, body: "Unauthorized" };
  }

  // Store connection with verified email
  await db.send(
    new PutCommand({
      TableName: Tables.connections,
      Item: {
        connectionId: connId,
        email,
        ttl: Math.floor(Date.now() / 1000) + 86400,
        connectedAt: Date.now(),
      },
    }),
  );

  // Get contacts to broadcast "online" only to them
  const [outgoing, incoming] = await Promise.all([
    db.send(new QueryCommand({
      TableName: Tables.contacts,
      KeyConditionExpression: "email = :e",
      FilterExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":e": email, ":s": "accepted" },
    })),
    db.send(new QueryCommand({
      TableName: Tables.contacts,
      IndexName: "contactEmail-index",
      KeyConditionExpression: "contactEmail = :e",
      FilterExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":e": email, ":s": "accepted" },
    })),
  ]);

  const contactEmails = new Set<string>();
  for (const item of (outgoing.Items ?? [])) contactEmails.add(item.contactEmail as string);
  for (const item of (incoming.Items ?? [])) contactEmails.add(item.email as string);

  // Get connections for each contact
  const connResults = await Promise.all(
    Array.from(contactEmails).map((e) =>
      db.send(new QueryCommand({
        TableName: Tables.connections,
        IndexName: "email-index",
        KeyConditionExpression: "email = :e",
        ExpressionAttributeValues: { ":e": e },
      })),
    ),
  );

  const contactConns = connResults.flatMap((r) => r.Items ?? []);

  const payload = new TextEncoder().encode(JSON.stringify({
    type: "presence",
    presenceType: "online",
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

  return { statusCode: 200, body: "Connected" };
};
