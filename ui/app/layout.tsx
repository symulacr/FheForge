import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import type React from "react";
import "./globals.css";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { HeroSection } from "@/components/hero-section";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import Footer from "@/components/shared/footer";
import { OnboardingBanner } from "@/components/shared/onboarding-banner";
import { SkipLink } from "@/components/shared/skip-link";

const AppProvider = dynamic(() => import("@/providers/fhenix-provider"), {
	ssr: false,
});

import { ToastProvider } from "@/providers/toast-provider";

const UserProvider = dynamic(
	() =>
		import("@/providers/user-provider").then((mod) => ({
			default: mod.UserProvider,
		})),
	{ ssr: false }
);

import { Preloader } from "@/components/preloader";
import { META_KEYWORDS, OG_IMAGE_WIDTH } from "@/lib/constants";
import { PreloaderProvider } from "@/providers/preloader-provider";
import { validateEnvVars } from "@/utils/addresses";

validateEnvVars();

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
	weight: ["400", "500", "600", "700"],
	display: "swap",
});

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://fheforge.app";

export const viewport: Viewport = {
	themeColor: "#09090b",
	colorScheme: "dark",
	width: "device-width",
	initialScale: 1,
};

export const metadata: Metadata = {
	metadataBase: new URL(baseUrl),
	title: {
		default: "FheForge — Confidential DeFi Strategies",
		template: "%s | FheForge",
	},
	description:
		"Build and execute FHE-encrypted DeFi strategies on Arbitrum Sepolia. Your positions stay private on-chain.",
	keywords: META_KEYWORDS,
	authors: [{ name: "FheForge", url: baseUrl }],
	openGraph: {
		title: "FheForge — Confidential DeFi Strategies",
		description:
			"FHE-encrypted DeFi protocol. Supply, borrow, and swap with encrypted amounts on Arbitrum Sepolia.",
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
		title: "FheForge — Confidential DeFi Strategies",
		description:
			"FHE-encrypted DeFi protocol. Supply, borrow, and swap with encrypted amounts on Arbitrum Sepolia.",
		images: ["/logo-fheforge.svg"],
		site: "@FheForgeApp",
		creator: "@FheForgeApp",
	},
	icons: {
		icon: "/logo-fheforge.svg",
		apple: "/logo-fheforge.svg",
	},
	robots: {
		index: true,
		follow: true,
	},
};

function LoadingFallback() {
	return (
		<div className="flex items-center justify-center min-h-screen">
			<div className="text-muted text-sm">Loading...</div>
		</div>
	);
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className="bg-background">
			<body
				className={`min-h-screen ${jetbrainsMono.variable} font-mono bg-background text-foreground antialiased`}
			>
				<ErrorBoundary>
					<AppProvider>
						<PreloaderProvider>
							<Preloader />
							<ToastProvider>
								<UserProvider>
									<Suspense fallback={<LoadingFallback />}>
										<div className="min-h-screen flex flex-col">
											<SkipLink />
											<HeroSection />
											<OnboardingBanner />
											<main
												id="main-content"
												tabIndex={-1}
												className="flex-1 pt-12 flex flex-col"
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
