"use client";

import Link from "next/link";
import { LogOut, User2 } from "lucide-react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ChatNavbar } from "@/components/ui/chat-navbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";

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
      left={<SidebarTrigger aria-label="Otwórz ustawienia" />}
      right={
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Menu użytkownika"><User2 className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild><Link href="/profile" className="flex w-full items-center"><User2 className="mr-2 h-4 w-4" />Profil</Link></DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer"><LogOut className="mr-2 h-4 w-4" />Wyloguj</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}
