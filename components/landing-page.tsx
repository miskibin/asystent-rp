"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { FcGoogle } from "react-icons/fc";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export type AuthProvider = "google" | "github";
type LoginPageProps = { onOAuthSignIn: (provider: AuthProvider) => void | Promise<void> };

const FEATURES = [
  { title: "Ustawy bez żargonu", text: "Sprawdź, czego dotyczy projekt i na jakim jest etapie." },
  { title: "Głosowania z kontekstem", text: "Dowiedz się, nad czym głosowano i co zdecydował Sejm." },
  { title: "Odpowiedzi ze źródłami", text: "Przejdź do dokumentów, na których opiera się odpowiedź." },
];

export default function LoginPage({ onOAuthSignIn }: LoginPageProps) {
  const [pending, setPending] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (provider: AuthProvider) => {
    if (pending) return;
    setPending(provider);
    setError(null);
    try {
      await onOAuthSignIn(provider);
    } catch {
      setPending(null);
      setError("Nie udało się rozpocząć logowania. Spróbuj ponownie.");
    }
  };

  return (
    <div className="asystent-landing flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-6 py-7 sm:px-10 lg:px-14">
        <Link href="/" aria-label="Asystent RP — strona główna" className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Image src="/logo.svg" alt="" width={30} height={30} priority />
          <span className="text-[17px] font-semibold tracking-tight">Asystent RP</span>
        </Link>
        <div className="flex items-center gap-5">
          <a href="https://tygodniksejmowy.pl" className="hidden items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex">Tygodnik Sejmowy<ArrowUpRight className="size-3.5" aria-hidden /></a>
          <ThemeToggle floating={false} aria-label="Zmień motyw" title="Zmień motyw" className="border-0 bg-transparent shadow-none" />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col justify-center px-6 pb-14 pt-10 sm:px-10 sm:pt-16 lg:px-14 lg:py-16">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-20 xl:gap-28">
          <section>
            <h1 className="max-w-[720px] text-[clamp(2.8rem,5.8vw,5.5rem)] leading-[1.04] font-medium tracking-[-0.065em] text-balance">
              Zrozum Sejm.<br /><span className="text-muted-foreground">Zapytaj wprost.</span>
            </h1>
            <p className="mt-7 max-w-[480px] text-base leading-7 text-muted-foreground sm:text-[18px] sm:leading-8">
              Ustawy, głosowania i przepisy — w jednej rozmowie.
              Asystent AI od Tygodnika Sejmowego pomaga zrozumieć je na podstawie dokumentów i danych.
            </p>
            <div className="mt-9 inline-flex items-center gap-2.5 text-sm text-foreground/80">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              Ty pytasz. Asystent sprawdza źródła.
            </div>
          </section>

          <section id="logowanie" aria-labelledby="login-heading" className="w-full max-w-md border-t border-border pt-8 lg:max-w-none lg:border-t-0 lg:border-l lg:pl-10 lg:pt-2">
            <h2 id="login-heading" className="text-[25px] leading-tight font-medium tracking-[-0.035em]">Zacznij rozmowę</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Zaloguj się, aby zadawać pytania i wracać do swoich rozmów.</p>
            <div className="mt-7 grid gap-3">
              <Button type="button" disabled={pending !== null} onClick={() => void signIn("google")} className="h-12 w-full gap-3 rounded-lg text-sm font-medium shadow-none">
                {pending === "google" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FcGoogle className="size-[18px] rounded-full bg-white" aria-hidden />}
                {pending === "google" ? "Łączenie z Google…" : "Kontynuuj z Google"}
              </Button>
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void signIn("github")} className="h-12 w-full gap-3 rounded-lg bg-transparent text-sm font-medium shadow-none">
                {pending === "github" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FaGithub className="size-[18px]" aria-hidden />}
                {pending === "github" ? "Łączenie z GitHub…" : "Kontynuuj z GitHub"}
              </Button>
            </div>
            {error ? <p role="alert" className="mt-4 text-sm leading-5 text-destructive">{error}</p> : null}
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              Korzystając z Asystenta, akceptujesz <Link href="/terms-of-service" className="underline decoration-border underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">regulamin</Link> i <Link href="/privacy" className="underline decoration-border underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">politykę prywatności</Link>.
            </p>
          </section>
        </div>

        <div className="mt-16 grid gap-7 border-t border-border pt-8 sm:grid-cols-3 sm:gap-8 lg:mt-24">
          {FEATURES.map((feature) => <section key={feature.title}>
            <h2 className="text-sm font-medium tracking-tight">{feature.title}</h2>
            <p className="mt-2 max-w-[290px] text-sm leading-6 text-muted-foreground">{feature.text}</p>
          </section>)}
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-6 pb-6 text-xs leading-5 text-muted-foreground sm:px-10 lg:px-14">
        <a href="https://tygodniksejmowy.pl" className="hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Projekt Tygodnika Sejmowego</a>
        <p>AI może się mylić. Sprawdzaj źródła.</p>
      </footer>
    </div>
  );
}
