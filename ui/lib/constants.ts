// ============================================================================
// Application Constants
// Extracted from magic numbers and hardcoded strings across the UI codebase.
// DO NOT put secrets or env vars here.
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// TIMING  — timeouts, delays, durations, polling intervals, stale times
// ─────────────────────────────────────────────────────────────────────────────

/** Axios / API request timeout (ms) */
export const API_TIMEOUT = 60_000;

/** Default React Query stale time for general queries (ms) */
export const QUERY_STALE_TIME = 60_000;

/** Longer stale time for relatively static user data (ms) */
export const QUERY_STALE_TIME_LONG = 5 * 60_000;

/** React Query garbage-collection time (ms) */
export const QUERY_GC_TIME = 5 * 60_000;

/** Preloader animation duration (ms) */
export const PRELOADER_DURATION = 300;

/** Delay before hiding preloader after animation completes (ms) */
export const PRELOADER_HIDE_DELAY = 100;

/** Auto-dismiss delay for toast notifications (ms) */
export const TOAST_AUTO_DISMISS_DELAY = 5_000;

/** Delay before a toast is removed from the DOM (ms) */
export const TOAST_REMOVE_DELAY = 1_000;

/** Interval for polling transaction receipts (ms) */
export const TX_POLLING_INTERVAL = 2_000;

/** Debounce delay for search inputs (ms) */
export const SEARCH_DEBOUNCE = 500;

/** Delay for ConfigPanel initialization timeout (ms) */
export const CONFIG_PANEL_INIT_DELAY = 100;

/** Default motion / UI transition duration (s) */
export const DEFAULT_TRANSITION_DURATION = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
// LIMITS  — page sizes, character limits, counts
// ─────────────────────────────────────────────────────────────────────────────

/** Default page size for paginated lists */
export const DEFAULT_PAGE_LIMIT = 10;

/** Default number of rows shown before "Show more" in tables */
export const TABLE_SHOW_MORE_LIMIT = 5;

/** Number of transaction hashes shown before expanding */
export const TX_HASH_SHOW_LIMIT = 3;

/** Maximum length for a strategy prompt (characters) */
export const PROMPT_MAX_LENGTH = 2_000;

/** Minimum length for a strategy prompt (characters) */
export const PROMPT_MIN_LENGTH = 10;

/** Maximum concurrent toasts */
export const TOAST_LIMIT = 1;

/** Default React Query retry count */
export const DEFAULT_RETRY_COUNT = 1;

// ─────────────────────────────────────────────────────────────────────────────
// CHAINS  — chain IDs, RPC URLs, block explorers
// ─────────────────────────────────────────────────────────────────────────────

/** Arbitrum Sepolia chain ID */
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421_614;

/** Arbitrum Sepolia RPC endpoint */
export const ARBITRUM_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc";

/** Arbitrum Sepolia block-explorer base URL */
export const ARBITRUM_SEPOLIA_EXPLORER = "https://sepolia.arbiscan.io";

/** Default CoFHE chain configuration object */
export const COFHE_CHAIN = {
	name: "Arbitrum Sepolia",
	chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
	rpc: ARBITRUM_SEPOLIA_RPC,
	nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACTS  — swap parameters, slippage, etc.
// ─────────────────────────────────────────────────────────────────────────────

/** Default swap deadline offset in seconds (1 hour) */
export const SWAP_DEADLINE_OFFSET = 3_600;

/** Default slippage tolerance (0.5%) */
export const SLIPPAGE_TOLERANCE = 0.5;

/** Slippage tolerance basis points multiplier (10000 = 100%) */
export const SLIPPAGE_BASIS_POINTS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// UI  — layout, meta, copy
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum content width (px) used in layout wrappers */
export const MAX_CONTENT_WIDTH = 1_920;

/** Open Graph image width (px) */
export const OG_IMAGE_WIDTH = 1_200;

/** Meta keywords for SEO */
export const META_KEYWORDS = [
	"FheForge",
	"DeFi",
	"Yield Farming",
	"Crypto Investment",
	"AI Strategies",
	"Blockchain",
];

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT ADDRESSES  — read from NEXT_PUBLIC_* env vars; empty string when unset
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_VAULT_ADDRESS = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
export const LENDING_POOL_ADDRESS = process.env.NEXT_PUBLIC_POOL_ADDRESS ?? "";
export const SWAP_ROUTER_ADDRESS = process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ?? "";
export const STRATEGY_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "";
