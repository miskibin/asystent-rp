"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LogOut, Star, Heart, User2 } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenuContent,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useChatStore } from "@/lib/store";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  createClientComponentClient,
  User,
} from "@supabase/auth-helpers-nextjs";
import { useRouter } from "next/navigation";
import { isUserPatron } from "@/lib/get-patronite-users";

const Navbar: React.FC = () => {
  const router = useRouter();
  const [isPatron, setIsPatron] = useState(false);
  const setPatrons = useChatStore((state) => state.setPatrons);

  const [user, setUser] = useState<User | null>(null);
  const supabase = createClientComponentClient();
  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
    };

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  useEffect(() => {
    const fetchAndSetPatrons = async () => {
      try {
        if (user?.email) {
          setIsPatron(await isUserPatron(user.email));
        }
      } catch (error) {
        console.error("Failed to fetch patrons:", error);
      }
    };

    fetchAndSetPatrons();
  }, [user, setPatrons]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <nav
      className={`flex items-center justify-between w-full ${
        isPatron
          ? "bg-gradient-to-r from-purple-600 to-indigo-600 shadow-lg dark:from-purple-800 dark:to-indigo-900"
          : "bg-card"
      } border-b border-border p-3 md:p-3`}
    >
      <div className="flex items-center space-x-2">
        <SidebarTrigger
          className={`mr-2 ${
            isPatron ? "text-white hover:bg-white/20" : "text-foreground"
          }`}
        />
        <h1
          className={`text-lg font-semibold ${
            isPatron ? "text-white" : "text-foreground/50"
          }`}
        >
          Asystent RP
        </h1>
        <div className="flex items-center bg-white/20 px-3 py-1 rounded-full">
          {isPatron ? (
            <>
              <Star className="w-4 h-4 text-yellow-300 mr-2" />
              <p className="text-sm font-medium text-white">Dziękuję!</p>
            </>
          ) : (
            <>
              <Heart className="w-4 h-4 text-destructive font-bold mr-2" />
              <Link href="https://patronite.pl/sejm-stats" className="text-sm ">
                Wesprzyj!
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={
                  isPatron ? "text-white hover:bg-white/20" : "text-foreground"
                }
              >
                <span className="sr-only">Opcje</span>
                <User2 className="h-6 w-6" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/profile" className="flex items-center w-full">
                  <User2 className="mr-2 h-4 w-4" />
                  <span>Profil</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleSignOut}
                className="flex items-center cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Wyloguj</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
