import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import type React from "react";
import "./globals.css";
import nextDynamic from "next/dynamic";
import { Suspense } from "react";
import { HeroSection } from "@/components/hero-section";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import Footer from "@/components/shared/footer";
import { OnboardingBanner } from "@/components/shared/onboarding-banner";
import { SkipLink } from "@/components/shared/skip-link";
const AppProvider = nextDynamic(
	() => import("@/providers/fhenix-provider"),
	{ ssr: false },
);
import { ToastProvider } from "@/providers/toast-provider";

const UserProvider = nextDynamic(
	() =>
		import("@/providers/user-provider").then((mod) => ({
			default: mod.UserProvider,
		})),
	{ ssr: false },
);

import { Preloader } from "@/components/preloader";
import { META_KEYWORDS, OG_IMAGE_WIDTH } from "@/lib/constants";
import { PreloaderProvider } from "@/providers/preloader-provider";
import { validateEnvVars } from "@/utils/addresses";

validateEnvVars();

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
	weight: ["400", "500", "700"],
});

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://fheforge.app";

export const metadata: Metadata = {
	metadataBase: new URL(baseUrl),
	title: "FheForge",
	description:
		"FHE-encrypted DeFi strategy execution on Arbitrum Sepolia. Positions invisible on-chain until you reveal them.",
	keywords: META_KEYWORDS,
	authors: [{ name: "FheForge Team", url: baseUrl }],
	openGraph: {
		title: "FheForge",
		description:
			"Maximize your DeFi investments with FheForge. Explore AI-driven strategies and earn yield across the Fhenix ecosystem.",
		url: baseUrl,
		siteName: "FheForge",
		images: [
			{
				url: "/logo-fheforge.svg",
				width: OG_IMAGE_WIDTH,
				height: 630,
				alt: "FheForge",
			},
		],
		locale: "en_US",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "FheForge – Fhenix DeFi Strategies & AI Yield Optimization",
		description:
			"Maximize your DeFi investments with FheForge. Explore AI-driven strategies and earn yield across the Fhenix ecosystem.",
		images: ["/logo-fheforge.svg"],
		site: "@FheForgeApp",
		creator: "@FheForgeApp",
	},
	icons: {
		icon: "/logo-fheforge.svg",
		apple: "/logo-fheforge.svg",
	},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body
				className={`min-h-screen ${jetbrainsMono.variable} font-mono bg-background text-foreground`}
			>
				<ErrorBoundary>
					<AppProvider>
						<PreloaderProvider>
							<Preloader />
							<ToastProvider>
								<UserProvider>
									<Suspense
										fallback={
											<div className="flex items-center justify-center min-h-screen text-muted text-sm">
												loading...
											</div>
										}
									>
										<div className="min-h-screen flex flex-col">
											<SkipLink />
											<HeroSection />
											<OnboardingBanner />
											<main
												id="main-content"
												tabIndex={-1}
												className="flex-1 pt-[60px] flex flex-col"
											>
												{children}
											</main>
											<Footer />
										</div>
									</Suspense>
								</UserProvider>
							</ToastProvider>
							<Analytics />
						</PreloaderProvider>
					</AppProvider>
				</ErrorBoundary>
			</body>
		</html>
	);
}
