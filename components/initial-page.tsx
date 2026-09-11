import { Building2, Scale, Users } from "lucide-react";

import { ChatEmptyState } from "@/components/ui/chat-empty-state";
import { Button } from "@/components/ui/button";

const STARTERS = [
  { icon: <Building2 className="h-4 w-4" />, label: "Najem mieszkania", prompt: "Jakie prawa ma najemca, gdy właściciel chce podnieść czynsz?" },
  { icon: <Users className="h-4 w-4" />, label: "Sprawy rodzinne", prompt: "Jak ustala się kontakty z dzieckiem po rozwodzie?" },
  { icon: <Scale className="h-4 w-4" />, label: "Sprawa urzędowa", prompt: "Jak przygotować się do odwołania od decyzji urzędu?" },
];

interface InitialChatContentProps {
  onStarterClick: (prompt: string) => void;
}

export default function InitialChatContent({ onStarterClick }: InitialChatContentProps) {
  return (
    <ChatEmptyState
      icon={<Scale />}
      title="W czym mogę pomóc?"
      description="Opisz swoją sytuację możliwie konkretnie. Otrzymasz uporządkowaną odpowiedź, ale ważne decyzje warto potwierdzić w źródłach lub z prawnikiem."
    >
      <div className="grid gap-2 text-left sm:grid-cols-3">
        {STARTERS.map((starter) => (
          <Button key={starter.label} type="button" variant="outline" onClick={() => onStarterClick(starter.prompt)} className="h-auto min-h-20 justify-start whitespace-normal px-3 py-3 text-left text-sm">
            {starter.icon}
            <span>{starter.label}</span>
          </Button>
        ))}
      </div>
    </ChatEmptyState>
  );
}
