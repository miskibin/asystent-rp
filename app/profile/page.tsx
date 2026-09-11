"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Mail,
  ArrowLeft,
  LogOut,
  Calendar,
  Shield,
  MessageSquare,
  ThumbsDown,
} from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClientComponentClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import FeedbackHistory from "@/components/feedback-history";

export default function ProfileClient() {
  const supabase = createClientComponentClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const getUser = async () => {
      try {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (error) throw error;
        setUser(user);
      } catch (e) {
        setError(e instanceof Error ? e : new Error("Wystąpił nieznany błąd"));
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

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Ładowanie profilu...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-[350px]">
          <CardHeader>
            <CardTitle className="text-center text-red-500">Błąd</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center">{error.message}</p>
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={() => (window.location.href = "/")}
            >
              Spróbuj ponownie
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    user && (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <Card className="w-full backdrop-blur-sm bg-white/80 dark:bg-gray-900/80">
            <CardHeader className="pb-4">
              <div className="flex justify-between items-center">
                <Link href="/" passHref>
                  <Button variant="ghost" size="sm">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Powrót
                  </Button>
                </Link>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await supabase.auth.signOut();
                        }}
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        Wyloguj
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Wyloguj się z aplikacji</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                <div className="flex flex-col items-center gap-4">
                  <Avatar className="h-32 w-32 ring-4 ring-primary/10">
                    <AvatarImage
                      src={
                        user.user_metadata.avatar_url ||
                        user.user_metadata.picture
                      }
                      alt={user.user_metadata.full_name || "User"}
                    />
                    <AvatarFallback className="text-3xl">
                      {user.user_metadata.full_name
                        ? user.user_metadata.full_name[0].toUpperCase()
                        : "U"}
                    </AvatarFallback>
                  </Avatar>
                  <Badge variant="secondary" className="text-xs">
                    Użytkownik
                  </Badge>
                </div>

                <div className="flex-1 space-y-6 text-center md:text-left">
                  <div>
                    <h2 className="text-3xl font-bold text-primary">
                      {user.user_metadata.full_name ||
                        user.email?.split("@")[0]}
                    </h2>
                    <div className="flex items-center justify-center md:justify-start gap-2 mt-2 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <p>{user.email}</p>
                    </div>
                  </div>
                  <div className="border-t pt-6  px-0 mx-0 mt-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <ThumbsDown className="h-4 w-4" />
                      Historia zgłoszeń
                    </h3>
                    <FeedbackHistory />
                  </div>

                  <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold mb-4">
                      Informacje dodatkowe
                    </h3>
                    <p className="text-muted-foreground text-sm">Brak.</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  );
}
