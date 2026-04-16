import { GetCommand } from "@aws-sdk/lib-dynamodb";
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
