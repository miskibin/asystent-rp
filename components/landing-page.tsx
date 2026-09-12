"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { Github, Landmark, Loader2, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export type AuthProvider = "google" | "github";

type LoginPageProps = {
  onOAuthSignIn: (provider: AuthProvider) => void | Promise<void>;
};

const providers: Array<{
  id: AuthProvider;
  label: string;
  icon: ReactNode;
  variant: "default" | "outline";
}> = [
  {
    id: "google",
    label: "Kontynuuj z Google",
    icon: <span className="grid size-4 place-items-center text-sm font-semibold">G</span>,
    variant: "default",
  },
  {
    id: "github",
    label: "Kontynuuj z GitHub",
    icon: <Github className="size-4" />,
    variant: "outline",
  },
];

export default function LoginPage({ onOAuthSignIn }: LoginPageProps) {
  const [pending, setPending] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (provider: AuthProvider) => {
    setPending(provider);
    setError(null);
    try {
      await onOAuthSignIn(provider);
    } catch (cause) {
      console.error("OAuth sign-in failed", cause);
      setPending(null);
      setError("Nie udało się rozpocząć logowania. Spróbuj ponownie.");
    }
  };

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <ThemeToggle floating={false} className="absolute top-4 right-4" />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-muted/70 to-transparent"
      />

      <section className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-sm font-medium">
          <Image src="/logo.svg" alt="" width={32} height={32} priority />
          <span>Asystent RP</span>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="mx-auto grid size-11 place-items-center rounded-xl border bg-muted/50">
            <Landmark className="size-5" aria-hidden />
          </div>
          <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight">
            Porozmawiaj o tym, co dzieje się w Sejmie
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-center text-sm leading-6 text-muted-foreground">
            Zaloguj się, aby zadawać pytania i wracać do zapisanych rozmów.
          </p>

          <div className="mt-7 grid gap-3">
            {providers.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant={provider.variant}
                size="lg"
                disabled={pending !== null}
                onClick={() => void signIn(provider.id)}
                className="w-full"
              >
                {pending === provider.id ? (
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                ) : (
                  <span className="mr-2">{provider.icon}</span>
                )}
                {provider.label}
              </Button>
            ))}
          </div>

          <p
            aria-live="polite"
            className="mt-4 min-h-5 text-center text-sm text-destructive"
          >
            {error}
          </p>

          <div className="mt-3 flex items-center justify-center gap-2 border-t pt-5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden />
            Rozmowy są dostępne wyłącznie na Twoim koncie.
          </div>
        </div>
      </section>
    </main>
  );
}
