"use client";

import Image from "next/image";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AuthProvider = "google" | "github" | "discord";

export default function LoginPage({ onOAuthSignIn }: { onOAuthSignIn: (provider: AuthProvider) => void | Promise<void> }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <Image src="/logo.svg" alt="" width={48} height={48} className="mx-auto mb-4" priority />
        <h1 className="text-2xl font-semibold tracking-tight">Asystent RP</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Zaloguj się, aby rozpocząć rozmowę.</p>
        <div className="mt-6 grid gap-3">
          <Button type="button" onClick={() => void onOAuthSignIn("google")}>Kontynuuj z Google</Button>
          <Button type="button" variant="outline" onClick={() => void onOAuthSignIn("github")}> 
            <Github className="mr-2 h-4 w-4" />Kontynuuj z GitHub
          </Button>
        </div>
      </section>
    </main>
  );
}

