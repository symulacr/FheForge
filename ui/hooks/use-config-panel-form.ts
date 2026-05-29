import { useState } from "react";
import type { DefiEstimate } from "@/app/builder/components/nodes/defi-node.types";

export function useConfigPanelForm() {
	const [tokenIn, setTokenIn] = useState("");
	const [tokenOut, setTokenOut] = useState("");
	const [amount, setAmount] = useState("");
	const [estimate, setEstimate] = useState<DefiEstimate | null>(null);
	const [estimating, setEstimating] = useState(false);
	const [error, setError] = useState("");
	const [isTokenInOpen, setIsTokenInOpen] = useState(false);
	const [isTokenOutOpen, setIsTokenOutOpen] = useState(false);
	const [revealed, setRevealed] = useState<string | null>(null);

	const reset = () => {
		setTokenIn("");
		setTokenOut("");
		setAmount("");
		setEstimate(null);
		setError("");
		setRevealed(null);
	};

	return {
		tokenIn,
		setTokenIn,
		tokenOut,
		setTokenOut,
		amount,
		setAmount,
		estimate,
		setEstimate,
		estimating,
		setEstimating,
		error,
		setError,
		isTokenInOpen,
		setIsTokenInOpen,
		isTokenOutOpen,
		setIsTokenOutOpen,
		revealed,
		setRevealed,
		reset,
	};
}
