"use client";
import "@cofhe/react/styles.css";
import {
  WagmiProvider,
  createConfig,
  http,
  useWalletClient,
  usePublicClient,
  useChainId,
  useAccount,
} from "wagmi";
import { connectors } from "@/hooks/use-fhe-wallet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { arbitrumSepolia } from "viem/chains";
import { createContext, useContext, useState, useRef } from "react";
import { createCofheConfig, CofheProvider } from "@cofhe/react";
import { arbSepolia } from "@cofhe/sdk/chains";
import { QUERY_STALE_TIME, DEFAULT_RETRY_COUNT, ARBITRUM_SEPOLIA_CHAIN_ID } from "@/lib/constants";

const wagmiConfig = createConfig({
  chains: [arbitrumSepolia],
  transports: { [arbitrumSepolia.id]: http() },
  connectors,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      refetchOnWindowFocus: false,
      retry: DEFAULT_RETRY_COUNT,
    },
  },
});

interface CofheClient {
  connect: (publicClient: unknown, walletClient: unknown) => Promise<void>;
  disconnect: () => Promise<void>;
  permits: { getOrCreateSelfPermit: () => Promise<unknown> };
  encryptInputs: (inputs: unknown[]) => { execute: () => Promise<unknown> };
  decryptForView: (
    ctHash: bigint,
    fheType: number,
  ) => { execute: () => Promise<bigint> };
  [key: string]: unknown;
}

export interface CofheState {
  client: CofheClient | null;
  isReady: boolean;
  isConnecting: boolean;
  permitReady: boolean;
  error: string | null;
  chainId: number | undefined;
}

const INITIAL_STATE: CofheState = {
  client: null,
  isReady: false,
  isConnecting: false,
  permitReady: false,
  error: null,
  chainId: undefined,
};

let cofheClientSingleton: CofheClient | null = null;

async function getClient() {
  if (typeof window === "undefined") {
    return null;
  }
  if (!cofheClientSingleton) {
    const mod = (await import("@cofhe/sdk/web")) as unknown as {
      createCofheClient?: (config: unknown) => CofheClient;
    };
    const factory = mod.createCofheClient;
    if (!factory) {
      throw new Error("@cofhe/sdk/web createCofheClient not available");
    }
    cofheClientSingleton = factory(
      createCofheConfig({ supportedChains: [arbSepolia] }),
    );
  }
  return cofheClientSingleton;
}

export const CofheClientContext = createContext<CofheClient | null>(null);
export const CofheStateContext = createContext<CofheState>(INITIAL_STATE);

export const useCofheClient = () => useContext(CofheClientContext);

export const useCofheState = () => useContext(CofheStateContext);

function CofheConnector({
  children,
  walletClient,
  publicClient,
  chainId,
}: {
  children: React.ReactNode;
  walletClient: ReturnType<typeof useWalletClient>["data"];
  publicClient: ReturnType<typeof usePublicClient>;
  chainId: number;
}) {
  const [client, setClient] = useState<CofheClient | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [permitReady, setPermitReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  if (!initRef.current) {
    initRef.current = true;
    (async () => {
      let c: CofheClient | null;
      try {
        c = await getClient();
      } catch (err) {
        setError("CoFHE SDK failed to load: " + String(err));
        return;
      }

      if (!c) {
        setError("CoFHE SDK not available on server");
        return;
      }
      setClient(c);

      if (!walletClient || !publicClient) return;

      if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
        setError("Please switch to Arbitrum Sepolia (chainId 421614)");
        return;
      }

      setIsConnecting(true);
      setError(null);

      try {
        await c.connect(publicClient, walletClient);
      } catch (err) {
        setError("CoFHE connection failed: " + String(err));
        setIsConnecting(false);
        return;
      }

      try {
        await c.permits.getOrCreateSelfPermit();
      } catch (err) {
        setError("CoFHE permit creation failed: " + String(err));
        setIsConnecting(false);
        return;
      }

      setPermitReady(true);
      setIsReady(true);
      setIsConnecting(false);
    })();
  }

  const state: CofheState = {
    client,
    isReady,
    isConnecting,
    permitReady,
    error,
    chainId,
  };

  return (
    <CofheClientContext.Provider value={client}>
      <CofheStateContext.Provider value={state}>
        <CofheProvider
          cofheClient={
            client as unknown as Parameters<
              typeof CofheProvider
            >[0]["cofheClient"]
          }
        >
          {children}
        </CofheProvider>
      </CofheStateContext.Provider>
    </CofheClientContext.Provider>
  );
}

function CofheConnectorWrapper({ children }: { children: React.ReactNode }) {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { address } = useAccount();

  return (
    <CofheConnector
      key={walletClient && address ? `${address}-${chainId}` : "disconnected"}
      walletClient={walletClient}
      publicClient={publicClient}
      chainId={chainId}
    >
      {children}
    </CofheConnector>
  );
}

export default function AppProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <CofheConnectorWrapper>{children}</CofheConnectorWrapper>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
