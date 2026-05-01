"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Layers, Workflow, Bookmark, Sparkles, Menu, X } from "lucide-react";
import { WalletButton } from "./shared/wallet-button";
import { usePreloader } from "@/providers/preloader-provider";

const NAV_ITEMS = [
  { icon: Layers, label: "Strategies", href: "/" },
  { icon: Workflow, label: "Builder", href: "/builder" },
  { icon: Bookmark, label: "My strategies", href: "/strategy" },
  { icon: Sparkles, label: "Prompt", href: "/prompt" },
] as const;

export function HeroSection() {
  const pathname = usePathname();
  const router = useRouter();
  const { show } = usePreloader();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigateTo = (href: string, e: React.MouseEvent) => {
    if (pathname === href) {
      setMobileOpen(false);
      return;
    }
    e.preventDefault();
    show();
    router.push(href);
    setMobileOpen(false);
  };

  return (
    <header
      role="banner"
      className="fixed top-0 left-0 z-50 h-12 w-full border-b border-border bg-background"
    >
      <div className="mx-auto flex h-full max-w-screen-2xl items-center justify-between px-4 md:px-6">
        <Link
          href="/"
          aria-label="FheForge home"
          className="text-sm font-bold uppercase tracking-widest text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          FHE<span className="text-accent">FORGE</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={(e) => navigateTo(href, e)}
                aria-current={active ? "page" : undefined}
                className={`flex h-9 items-center gap-1.5 border px-3 text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-transparent text-muted hover:border-border hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <WalletButton />
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center border border-border text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
          >
            {mobileOpen ? (
              <X className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Menu className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile primary"
          className="border-b border-border bg-background md:hidden"
        >
          <ul className="flex flex-col py-2">
            {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={(e) => navigateTo(href, e)}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-12 items-center gap-3 px-6 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active
                        ? "bg-accent/10 text-accent"
                        : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
