"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClientComponentClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ChatNavbar } from "@/components/ui/chat-navbar";

export default function Navbar() {
  const router = useRouter();
  const supabase = createClientComponentClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  };

  return (
    <ChatNavbar
      title="Asystent RP"
      right={
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            DeepSeek V4 Flash
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            aria-label="Wyloguj"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      }
    />
  );
}
