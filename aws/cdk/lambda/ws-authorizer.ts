import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, Tables } from "./shared/db";

interface WsAuthEvent {
  queryStringParameters?: Record<string, string>;
  requestContext: {
    connectionId: string;
    routeKey: string;
    apiId: string;
    stage: string;
  };
  methodArn?: string;
}

interface AuthResponse {
  principalId: string;
  policyDocument: {
    Version: string;
    Statement: Array<{
      Action: string;
      Effect: string;
      Resource: string;
    }>;
  };
  context?: Record<string, string>;
}

function generatePolicy(
  principalId: string,
  effect: "Allow" | "Deny",
  resource: string,
  context?: Record<string, string>,
): AuthResponse {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context,
  };
}

export const handler = async (event: WsAuthEvent): Promise<AuthResponse> => {
  const token = event.queryStringParameters?.token ?? "";
  const deviceId = event.queryStringParameters?.deviceId ?? "";

  // Build the ARN for the policy
  const { apiId, stage } = event.requestContext;
  const resource = `arn:aws:execute-api:*:*:${apiId}/${stage}/*`;

  if (!token || !deviceId) {
    return generatePolicy("unknown", "Deny", resource);
  }

  try {
    const { Item } = await db.send(
      new GetCommand({
        TableName: Tables.deviceSessions,
        Key: { deviceToken: token },
      }),
    );

    if (!Item) {
      return generatePolicy("unknown", "Deny", resource);
    }

    if (Item.deviceId !== deviceId) {
      return generatePolicy("unknown", "Deny", resource);
    }

    const email = Item.email as string;

    return generatePolicy(email, "Allow", resource, {
      email,
      userId: Item.userId as string,
    });
  } catch {
    return generatePolicy("unknown", "Deny", resource);
  }
};
