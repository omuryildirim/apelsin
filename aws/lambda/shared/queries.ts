import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db, Tables } from "./db";

/** Fetch a user record by email. Returns the raw Item or null. */
export const getUser = async (email: string) => {
  const { Item } = await db.send(new GetCommand({
    TableName: Tables.users,
    Key: { email },
  }));
  return Item ?? null;
};

export const getDisplayName = async (email: string): Promise<string> => {
  const user = await getUser(email);
  return (user?.displayName as string) || email;
};

// Accepted contacts are written bidirectionally, so a single-direction query is sufficient.
export const getAcceptedContactEmails = async (email: string): Promise<string[]> => {
  const { Items = [] } = await db.send(new QueryCommand({
    TableName: Tables.contacts,
    KeyConditionExpression: "email = :e",
    FilterExpression: "#s = :s",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":e": email, ":s": "accepted" },
  }));
  return Items.map((item) => item.contactEmail as string);
};
