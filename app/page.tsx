"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";

import { ChatProvider } from "./ChatContext";
import { ChatWorkspace } from "@/components/chat-workspace";
import { createClientComponentClient } from "@/lib/supabase/client";
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
      <ChatWorkspace />
    </ChatProvider>
  );
}
