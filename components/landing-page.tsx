import React, { Suspense, lazy } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Search, Database, CalendarClock } from "lucide-react";
import FeatureCard from "./landing-page/featureCard";
import LoginCard from "./landing-page/login";
import Footer from "./landing-page/footer";
import Image from "next/image";
export type AuthProvider = "google" | "discord" | "github";

// Lazy load non-critical sections
const FlowDiagram = lazy(() => import("./landing-page/diagram"));
const EvolutionSection = lazy(() => import("./landing-page/about"));
const ComparisonSection = lazy(
  () => import("./landing-page/comparsion-section")
);
// Loading fallback component
const SectionLoader = () => (
  <div className="w-full h-48 flex items-center justify-center">
    <div className="animate-pulse w-full max-w-2xl h-32 bg-secondary/20 rounded-lg" />
  </div>
);

interface LoginPageProps {
  onOAuthSignIn: (provider: AuthProvider) => void;
  windowHeight: string;
}

const stagger = {
  visible: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};


export const LoginPage: React.FC<LoginPageProps> = ({
  onOAuthSignIn,
  windowHeight,
}) => {
  return (
    <div
      className="flex flex-col bg-gradient-to-b from-background to-secondary/20 overflow-x-hidden "
      style={{ minHeight: windowHeight }}
    >
      <div className="w-full border-b border-primary/20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-center gap-2">
          <CalendarClock className="w-5 h-5 text-destructive" />
          <p className="text-sm md:text-base font-medium text-primary">
              Poszukujemy osób do zespołu! (Napisz na discordzie)
          </p>
        </div>
      </div>
      <div className="w-full mx-auto px-0.5  md:px-4 mb-12">
        <div className="grid md:grid-cols-2 px-2  py-8 md:py-12 gap-12 items-center min-h-screen max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="space-y-8"
          >
            <motion.div variants={fadeIn} className="space-y-4">
              <div className="flex items-center gap-4 mb-6">
                <Image
                  src="/logo.svg"
                  alt="Asystent RP Logo"
                  width={64}
                  height={64}
                  className="rounded-lg"
                  priority
                />
                <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Asystent RP
                </h1>
              </div>
              <p className="text-xl text-muted-foreground">
                Twój inteligentny przewodnik po polskim prawie
              </p>
            </motion.div>

            <motion.div variants={stagger} className="space-y-4">
              <FeatureCard
                icon={MessageSquare}
                title="Inteligentna Analiza z GPT-4"
                description="Zamiast przeszukiwania setki aktów, poprostu spytaj"
              />
              <FeatureCard
                icon={Search}
                title="Interpretacja Aktów Prawnych"
                description="Dopytaj o dowoną kwestię, a asystent odpowie na pytanie"
              />
              <FeatureCard
                icon={Database}
                title="Baza Wiedzy"
                description="Dostęp do wektorowej bazy danych ponad 7 tysięcy aktów prawnych"
              />
            </motion.div>
          </motion.div>

          <div className="relative z-10">
            <LoginCard onOAuthSignIn={onOAuthSignIn} />
          </div>
        </div>

        <Suspense fallback={<SectionLoader />}>
          <ComparisonSection />
        </Suspense>

        <div className="hidden md:block">
          <Suspense fallback={<SectionLoader />}>
            <FlowDiagram />
          </Suspense>
        </div>

        <Suspense fallback={<SectionLoader />}>
          <EvolutionSection />
        </Suspense>
      </div>

      <Footer />
    </div>
  );
};

export default LoginPage;
