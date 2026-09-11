import React from "react";
import { Github, Heart, Youtube, Mail, ExternalLink } from "lucide-react";
import { FaDiscord } from "react-icons/fa";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  type FooterLink = {
    href: string;
    label: string;
    icon?: React.ReactElement;
  };

  const footerSections: { title: string; links: FooterLink[] }[] = [
    {
      title: "O nas",
      links: [
        { href: "/about", label: "O projekcie" },
        { href: "mailto:michalskibinski109@gmail.com", label: "Kontakt" },
      ],
    },
    {
      title: "Dokumenty",
      links: [
        { href: "/privacy", label: "Polityka prywatności" },
        { href: "/terms-of-service", label: "Regulamin" },
      ],
    },
    {
      title: "Społeczność",
      links: [
        {
          href: "https://github.com/miskibin/ollama-ui",
          label: "GitHub",
          icon: <Github className="w-5 h-5" />,
        },
        {
          href: "https://patronite.pl/sejm-stats",
          label: "Patronite",
          icon: <Heart className="w-5 h-5 text-destructive" />,
        },
        {
          href: "https://www.youtube.com/@sejm-stats",
          label: "YouTube",
          icon: <Youtube className="w-5 h-5 text-destructive" />,
        },
        {
          href: "https://discord.com/invite/zH2J3z5Wbf",
          label: "Discord",
          icon: <FaDiscord className="w-5 h-5 text-primary" />,
        },
      ],
    },
  ];

  return (
    <footer className="w-full py-12 bg-card text-foreground">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {footerSections.map((section) => (
            <div key={section.title}>
              <h2 className="text-lg font-semibold mb-4">{section.title}</h2>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target={
                        link.href.startsWith("http") ? "_blank" : undefined
                      }
                      rel={
                        link.href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.icon &&
                        React.cloneElement(link.icon as React.ReactElement<{ "aria-hidden"?: boolean }>, {
                          "aria-hidden": "true",
                        })}
                      <span>{link.label}</span>
                      {link.href.startsWith("http") && (
                        <ExternalLink className="w-4 h-4" aria-hidden="true" />
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-sm text-muted-foreground">
            © {currentYear} Michał Skibiński. Wszelkie prawa zastrzeżone.
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>powered by</span>
            <a
              href="https://sejm-stats.pl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              sejm-stats.pl
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
