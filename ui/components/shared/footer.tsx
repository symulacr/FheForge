import Link from "next/link";
import {
	ARBITRUM_SEPOLIA_EXPLORER,
	LENDING_POOL_ADDRESS,
	STRATEGY_REGISTRY_ADDRESS,
	STRATEGY_VAULT_ADDRESS,
	SWAP_ROUTER_ADDRESS,
} from "@/lib/constants";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

interface ContractEntry {
	name: string;
	address: string;
}

const CONTRACTS: ContractEntry[] = [
	{ name: "Vault", address: STRATEGY_VAULT_ADDRESS },
	{ name: "Pool", address: LENDING_POOL_ADDRESS },
	{ name: "Router", address: SWAP_ROUTER_ADDRESS },
	{ name: "Registry", address: STRATEGY_REGISTRY_ADDRESS },
];

function shortAddress(addr: string): string {
	if (!addr) return "--";
	return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function Footer() {
	return (
		<footer className="border-t border-border bg-background py-3 text-xs text-muted">
			<div className="mx-auto flex max-w-screen-2xl flex-col gap-2 px-4 md:flex-row md:items-center md:justify-between md:px-6">
				{/* Brand & Network */}
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<span className="font-semibold uppercase tracking-widest text-foreground">
						FheForge
					</span>
					<span className="text-border" aria-hidden>|</span>
					<span>Arbitrum Sepolia</span>
					<span className="text-border" aria-hidden>|</span>
					<span className="tabular-nums">v{APP_VERSION}</span>
				</div>

				{/* Contract Links */}
				<ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
					{CONTRACTS.filter((c) => c.address).map((c) => (
						<li key={c.name}>
							<Link
								href={`${ARBITRUM_SEPOLIA_EXPLORER}/address/${c.address}`}
								target="_blank"
								rel="noopener noreferrer"
								className="tabular-nums transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								aria-label={`${c.name} contract on Arbiscan: ${c.address}`}
							>
								<span className="text-muted-foreground">{c.name}:</span>{" "}
								<span className="text-foreground">{shortAddress(c.address)}</span>
							</Link>
						</li>
					))}
				</ul>
			</div>
		</footer>
	);
}
