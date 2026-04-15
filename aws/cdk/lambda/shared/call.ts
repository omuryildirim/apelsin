import { QueryCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { db, Tables, WS_ENDPOINT } from "./db";
import { sendPush } from "./push";
import { getDisplayName } from "./queries";

let mgmt: ApiGatewayManagementApiClient | undefined;
const getMgmt = () => {
  if (!mgmt) mgmt = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });
  return mgmt;
};

/** Relay a payload to all of a user's active WebSocket connections. */
export const relayToConnections = async (email: string, payload: Record<string, unknown>) => {
  const { Items = [] } = await db.send(new QueryCommand({
    TableName: Tables.connections,
    IndexName: "email-index",
    KeyConditionExpression: "email = :e",
    ExpressionAttributeValues: { ":e": email },
  }));

  const data = Buffer.from(JSON.stringify(payload));
  await Promise.allSettled(
    Items.map(async (conn) => {
      try {
        await getMgmt().send(
          new PostToConnectionCommand({ ConnectionId: conn.connectionId as string, Data: data }),
        );
      } catch {
        // stale connection — ignore
      }
    }),
  );
};

/**
 * Cancel an active outgoing call: delete the call record,
 * send a missed-call push to the callee, and relay call-end via WebSocket.
 */
export const cancelCall = async (callerEmail: string) => {
  const { Item: callRecord } = await db.send(new GetCommand({
    TableName: Tables.calls,
    Key: { caller: callerEmail },
  }));

  if (callRecord?.callee) {
    await db.send(new DeleteCommand({
      TableName: Tables.calls,
      Key: { caller: callerEmail },
    }));

    const displayName = await getDisplayName(callerEmail);

    await Promise.all([
      sendPush(callRecord.callee as string, displayName, "Missed call", {
        type: "missed-call",
        from: callerEmail,
        caller: callerEmail,
      }, "high", 300),
      relayToConnections(callRecord.callee as string, {
        type: "call",
        callType: "call-end",
        from: callerEmail,
        data: {},
      }),
    ]);
  }
};
