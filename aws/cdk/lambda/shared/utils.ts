export function normalizeChatId(chatId: string): string {
  const trimmed = chatId.trim();
  const parts = trimmed.split("__");
  if (parts.length === 2) {
    return [parts[0].trim().toLowerCase(), parts[1].trim().toLowerCase()]
      .sort()
      .join("__");
  }
  return trimmed.toLowerCase();
}

/** Zero-padded timestamp prefix so lexicographic order = chronological order. */
export function messageSortKey(timestamp: number, id: string): string {
  return `${String(timestamp).padStart(16, "0")}#${id}`;
}

export function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  };
}

export function ok(body: unknown, status = 200) {
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify(body) };
}

export function err(message: string, status = 400) {
  return { statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}
