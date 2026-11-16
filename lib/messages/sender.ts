export const DELETED_USER_LABEL = "Deleted user";

export type MessageSender = {
  id: string;
  name: string | null;
  image: string | null;
} | null;

export function getSenderDisplayName(sender: MessageSender | undefined): string {
  return sender?.name ?? DELETED_USER_LABEL;
}
