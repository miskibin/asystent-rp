"use client";
import React, { useState, useEffect } from "react";
import { ChatCard } from "@/components/chatCard";
import { ChatProvider } from "./ChatContext";
import {
  createClientComponentClient,
  User,
} from "@supabase/auth-helpers-nextjs";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/sidebar";
import Navbar from "@/components/navbar";
import { Mail, Loader2, Lock } from "lucide-react";
import LoginPage, { AuthProvider } from "@/components/landing-page";

export default function Home() {
  const supabase = createClientComponentClient();
  const isDev = process.env.NODE_ENV === "development";
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowHeight, setWindowHeight] = useState("100dvh");

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(`${window.innerHeight}px`);
    };

    setWindowHeight(`${window.innerHeight}px`);

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const getUser = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        setUser(user);
      } catch (error) {
        console.error("Error fetching user:", error);
      } finally {
        setLoading(false);
      }
    };

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  const handleOAuthSignIn = async (provider: AuthProvider) => {
    try {
      await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
    } catch (error) {
      console.error(`Error signing in with ${provider}:`, error);
    }
  };

  if (loading) {
    return (
      <div
        className="grid place-items-center w-full"
        style={{ height: windowHeight }}
      >
        <div className="text-center">
          <Loader2 className="h-16 w-16 animate-spin mx-auto text-primary" />
          <p className="mt-4 text-lg font-medium text-muted-foreground">
            Ładowanie...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onOAuthSignIn={handleOAuthSignIn}
        windowHeight={windowHeight}
      />
    );
  }

  return (
    <ChatProvider>
      <SidebarProvider>
        <AppSidebar />
        <main className="min-w-0 flex-1">
          <div className="flex flex-col h-[100dvh] overflow-hidden">
            <Navbar />
            <div className="min-h-0 flex-1">
              <ChatCard />
            </div>
          </div>
        </main>
      </SidebarProvider>
    </ChatProvider>
  );
}
