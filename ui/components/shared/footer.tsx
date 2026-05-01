import Link from "next/link";
import {
  STRATEGY_VAULT_ADDRESS,
  LENDING_POOL_ADDRESS,
  SWAP_ROUTER_ADDRESS,
  STRATEGY_REGISTRY_ADDRESS,
  ARBITRUM_SEPOLIA_EXPLORER,
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
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Footer() {
  return (
    <footer className="border-t border-border bg-background py-4 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-bold uppercase tracking-widest text-foreground">
            FheForge
          </span>
          <span aria-hidden>·</span>
          <span>Arbitrum Sepolia (421614)</span>
          <span aria-hidden>·</span>
          <span>v{APP_VERSION}</span>
        </div>

        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {CONTRACTS.filter((c) => c.address).map((c) => (
            <li key={c.name}>
              <Link
                href={`${ARBITRUM_SEPOLIA_EXPLORER}/address/${c.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`${c.name} contract on Arbiscan: ${c.address}`}
              >
                {c.name}: {shortAddress(c.address)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
