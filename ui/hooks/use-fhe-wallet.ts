import { useAccount, useBalance, useConnect, useDisconnect } from "wagmi";
import { coinbaseWallet, injected, safe, walletConnect } from "wagmi/connectors";

/** Wallet connectors supported by FheForge. */
export const connectors = [
	injected(),
	coinbaseWallet({ appName: "FheForge" }),
	walletConnect({
		projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
	}),
	safe(),
] as const;

export function useFheWallet() {
	const { address, isConnected } = useAccount();
	const { connect, isPending: isLoading } = useConnect();
	const { disconnect } = useDisconnect();
	const { data: balance } = useBalance({ address });
	const user = isConnected && address ? { id: address, wallet_address: address } : null;
	return {
		user,
		address,
		isConnected,
		isLoading,
		balance,
		connectWallet: () => connect({ connector: connectors[0] }),
		disconnectWallet: disconnect,
	};
}
