import { MessageSquare } from "lucide-react";
import { ChatEmptyState } from "@/components/ui/chat-empty-state";

export default function InitialChatContent() {
  return (
    <ChatEmptyState
      icon={<MessageSquare />}
      title="Jak mogę pomóc?"
      description="Napisz wiadomość, aby rozpocząć rozmowę."
    />
  );
}
