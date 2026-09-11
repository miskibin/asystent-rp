"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";

import { ChatCard } from "@/components/chatCard";
import { ChatProvider } from "./ChatContext";
import { createClientComponentClient } from "@/lib/supabase/client";
import Navbar from "@/components/navbar";
import LoginPage, { type AuthProvider } from "@/components/landing-page";

export default function Home() {
  const supabase = useMemo(() => createClientComponentClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const handleOAuthSignIn = async (provider: AuthProvider) => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  if (loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Ładowanie" />
      </main>
    );
  }

  if (!user) return <LoginPage onOAuthSignIn={handleOAuthSignIn} />;

  return (
    <ChatProvider>
      <main className="flex h-[100dvh] flex-col overflow-hidden">
        <Navbar />
        <div className="min-h-0 flex-1"><ChatCard /></div>
      </main>
    </ChatProvider>
  );
}
