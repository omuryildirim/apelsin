export interface Message {
  id: string;
  chatId: string;
  author: string;
  to?: string;
  type: "text" | "image" | "audio";
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  replyTo?: { id: string; author: string; text?: string };
  reactions?: Record<string, string[]>; // emoji → list of user emails
  timestamp: number;
}

export interface User {
  userId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  token: string;
  publicKeyJwk?: string;
}

export interface SignalMessage {
  type: "offer" | "answer" | "candidate";
  from: string;
  to: string;
  data: Record<string, unknown>;
  timestamp: number;
}
