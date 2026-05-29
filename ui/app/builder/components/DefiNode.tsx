"use client";
import type { DefiNodeProps } from "./nodes/defi-node.types";
import DefiNodeBorrow, { BorrowRightLabel } from "./nodes/defi-node-borrow";
import DefiNodeDefault from "./nodes/defi-node-default";
import DefiNodeShell from "./nodes/defi-node-shell";
import DefiNodeSupply, { SupplyRightLabel } from "./nodes/defi-node-supply";
import DefiNodeSwap, { SwapRightLabel } from "./nodes/defi-node-swap";
import { normalizeDefiNodeData, resolveDefiOperationType } from "./nodes/defi-node-utils";

export default function DefiNode({ data, selected }: DefiNodeProps) {
	const resolvedType = resolveDefiOperationType(data);
	const normalized = normalizeDefiNodeData(data);

	const commonProps = {
		nodeId: data.id,
		selected,
		title: normalized.title,
		protocolName: normalized.protocolName,
		onDelete: data?.onDelete,
	};

	if (!normalized.isConfigured) {
		return (
			<DefiNodeShell {...commonProps}>
				<DefiNodeDefault />
			</DefiNodeShell>
		);
	}

	switch (resolvedType) {
		case "SUPPLY":
			return (
				<DefiNodeShell {...commonProps} rightLabel={<SupplyRightLabel apy={normalized.apy} />}>
					<DefiNodeSupply data={normalized} />
				</DefiNodeShell>
			);

		case "BORROW":
			return (
				<DefiNodeShell {...commonProps} rightLabel={<BorrowRightLabel apy={normalized.apy} />}>
					<DefiNodeBorrow data={normalized} />
				</DefiNodeShell>
			);

		case "SWAP":
			return (
				<DefiNodeShell
					{...commonProps}
					rightLabel={<SwapRightLabel slippage={normalized.slippage} />}
				>
					<DefiNodeSwap data={normalized} />
				</DefiNodeShell>
			);

		default:
			return (
				<DefiNodeShell {...commonProps}>
					<DefiNodeDefault />
				</DefiNodeShell>
			);
	}
}
