import type { CreateConnectorFn } from "wagmi";
import { useAccount, useBalance, useConnect, useDisconnect } from "wagmi";
import { coinbaseWallet, injected, safe, walletConnect } from "wagmi/connectors";

/** Wallet connectors supported by FheForge. */
export const connectors: readonly CreateConnectorFn[] = [
	injected() as unknown as CreateConnectorFn,
	coinbaseWallet({ appName: "FheForge" }) as unknown as CreateConnectorFn,
	walletConnect({
		projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
	}) as unknown as CreateConnectorFn,
	safe() as unknown as CreateConnectorFn,
];
function connectWalletAction(
	connect: ReturnType<typeof useConnect>["connect"],
	connector: unknown,
) {
	(connect as (args: { connector: unknown }) => void)({ connector });
}

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
		connectWallet: () => connectWalletAction(connect, connectors[0]),
		disconnectWallet: disconnect,
	};
}
