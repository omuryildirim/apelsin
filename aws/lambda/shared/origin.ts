import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { err } from "./utils";

/**
 * Verifies the request came through CloudFront by checking the
 * X-Origin-Secret header. When ORIGIN_SECRET is unset, the check is
 * skipped so things work before the secret is configured.
 */
export function verifyOrigin(
  event: APIGatewayProxyEventV2,
): ReturnType<typeof err> | null {
  const expected = process.env.ORIGIN_SECRET ?? "";
  if (!expected) return null;

  const provided = event.headers["x-origin-secret"] ?? "";
  if (provided !== expected) {
    return err("Forbidden", 403);
  }
  return null;
}
