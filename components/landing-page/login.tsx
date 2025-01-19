import React from "react";
import { motion } from "framer-motion";
import { FaGoogle, FaGithub, FaDiscord, FaShieldAlt } from "react-icons/fa";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AuthProvider } from "../landing-page";

interface LoginCardProps {
  onOAuthSignIn: (provider: AuthProvider) => void;
}

const LoginCard: React.FC<LoginCardProps> = ({ onOAuthSignIn }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.3, type: "spring", stiffness: 100 }}
    className="flex flex-col items-center"
  >
    <Card className="w-full max-w-sm border-secondary/20 bg-gradient-to-br from-background via-background to-secondary/10 backdrop-blur-sm shadow-lg">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl text-center">Zaloguj się</CardTitle>
        <CardDescription className="text-center">
          Wymagane logowanie ze względu na koszty utrzymania usługi i limity
          zapytań
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <Button
            onClick={() => onOAuthSignIn("google")}
            variant="outline"
            className="w-full bg-white hover:bg-gray-50 text-gray-800 border border-gray-200 shadow-sm transition-all duration-300"
          >
            <FaGoogle className="mr-2 h-4 w-4 text-red-500" />
            Zaloguj się przez Google
          </Button>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <Button
            onClick={() => onOAuthSignIn("discord")}
            className="w-full bg-[#5865F2] hover:bg-[#4752C4] text-white transition-all duration-300"
          >
            <FaDiscord className="mr-2 h-5 w-5" />
            Zaloguj się przez Discorda
          </Button>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          <Button
            onClick={() => onOAuthSignIn("github")}
            className="w-full bg-[#24292e] hover:bg-[#1a1e22] text-white transition-all duration-300"
          >
            <FaGithub className="mr-2 h-5 w-5" />
            Zaloguj się przez GitHub
          </Button>
        </motion.div>

        <div className="pt-4 text-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex items-center justify-center text-sm text-muted-foreground"
          >
            <FaShieldAlt className="h-4 w-4 mr-2 text-green-500" />
            Twoje dane są bezpieczne.
          </motion.div>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

export default LoginCard;
