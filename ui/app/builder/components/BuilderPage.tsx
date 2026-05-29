"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import type { Connection, Edge, Node } from "reactflow";
import { BackgroundVariant } from "reactflow";
import type { DefiNodeData } from "@/app/builder/components/nodes/defi-node.types";
import { displayToast } from "@/components/shared/toast-manager";
import { useDefiModules } from "@/hooks/use-defi-modules";
import { useDefiBuilder } from "@/hooks/use-strategy-builder";
import { canBeFirstStep, validateConnection } from "@/lib/defi-connection-rules";
import { usePreloader } from "@/providers/preloader-provider";
import type { Action, Module } from "@/types/defi";
import ConfigPanel from "./ConfigPanel";
import CreateStrategyModal from "./CreateStrategyModal";
import DefiNode from "./DefiNode";
import Sidebar from "./Sidebar";

const ReactFlow = dynamic(() => import("reactflow").then((mod) => mod.ReactFlow), {
	ssr: false,
	loading: () => <div>Loading builder...</div>,
});
const ReactFlowProvider = dynamic(() => import("reactflow").then((mod) => mod.ReactFlowProvider), {
	ssr: false,
	loading: () => null,
});
const Background = dynamic(() => import("reactflow").then((mod) => mod.Background), {
	ssr: false,
	loading: () => null,
});
const Controls = dynamic(() => import("reactflow").then((mod) => mod.Controls), {
	ssr: false,
	loading: () => null,
});
const MiniMap = dynamic(() => import("reactflow").then((mod) => mod.MiniMap), {
	ssr: false,
	loading: () => null,
});

const addEdge = (params: Edge | Connection, edges: Edge[]) => {
	const id = (params as Edge).id ?? `e${edges.length + 1}`;
	if (edges.find((e) => e.source === params.source && e.target === params.target)) {
		return edges;
	}
	return [...edges, { id, ...params } as Edge];
};

const nodeTypes = {
	defiNode: DefiNode,
};

function Builder() {
	const { show, hide } = usePreloader();
	const { data: modules = [], isFetching } = useDefiModules();
	const prevFetching = useRef(isFetching);
	if (isFetching !== prevFetching.current) {
		prevFetching.current = isFetching;
		if (isFetching) show();
		else hide();
	}

	const {
		nodes,
		edges,
		selectedNode,
		showModal,
		creating,

		setSelectedNode,
		setShowModal,

		onNodesChange,
		onEdgesChange,
		setEdges,

		addNode,
		saveConfig,
		createStrategy,
	} = useDefiBuilder();

	const validateWorkflow = () => {
		if (!nodes || nodes.length === 0) {
			displayToast("error", "Please add at least one step before creating strategy.");
			return false;
		}

		const hasUnconfigured = nodes.some((node) => !node.data?.config);

		if (hasUnconfigured) {
			displayToast("error", "Please configure and save all steps before creating strategy.");
			return false;
		}

		return true;
	};

	const handleAddNode = (module: Module, action: Action) => {
		const isFirstNode = nodes.length === 0;
		const operationType = action?.operation_type;

		if (isFirstNode) {
			const result = canBeFirstStep(operationType);

			if (!result.valid) {
				displayToast("error", result.message);
				return;
			}
		}

		addNode(module, action);
	};

	const getOperationType = (node: Node<DefiNodeData>) => {
		return node?.data?.action?.operation_type || node?.data?.action?.type || "";
	};

	const isValidConnection = (connection: Connection) => {
		const sourceNode = nodes.find((node) => node.id === connection.source);
		const targetNode = nodes.find((node) => node.id === connection.target);

		if (!sourceNode || !targetNode) return false;

		if (connection.source === connection.target) return false;

		const sourceType = getOperationType(sourceNode);
		const targetType = getOperationType(targetNode);

		const result = validateConnection(sourceType, targetType);

		return result.valid;
	};

	const handleConnect = (connection: Connection) => {
		const sourceNode = nodes.find((node) => node.id === connection.source);
		const targetNode = nodes.find((node) => node.id === connection.target);

		if (!sourceNode || !targetNode) {
			displayToast("error", "Invalid connection.");
			return;
		}

		if (connection.source === connection.target) {
			displayToast("error", "A step cannot connect to itself.");
			return;
		}

		const edgeExists = edges.some(
			(edge) => edge.source === connection.source && edge.target === connection.target,
		);

		if (edgeExists) {
			displayToast("error", "This connection already exists.");
			return;
		}

		const sourceType = getOperationType(sourceNode);
		const targetType = getOperationType(targetNode);

		const result = validateConnection(sourceType, targetType);

		if (!result.valid) {
			displayToast("error", result.message);
			return;
		}

		setEdges((eds) => addEdge(connection, eds));
	};

	return (
		<div className="flex flex-1 text-white px-6 pb-6 pt-4 min-h-0 gap-6">
			<div className="w-80 custom-scroll pr-2">
				<Sidebar modules={modules} onSelect={handleAddNode} />
			</div>

			<div
				className="
          flex-1
          relative
          glass
         
          overflow-hidden
          border border-border
        "
			>
				<ReactFlow
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={handleConnect}
					isValidConnection={isValidConnection}
					onNodeClick={(_, node) => setSelectedNode(node)}
					fitView
				>
					<button
						onClick={() => {
							if (!validateWorkflow()) return;
							setShowModal(true);
						}}
						className="defi-btn-glass defi-create-btn active:scale-95 transition-transform"
						aria-label="Create strategy from current workflow"
					>
						Create Strategy
					</button>

					<MiniMap
						className="defi-minimap"
						style={{
							width: 140,
							height: 90,
						}}
					/>

					<Controls />

					<Background
						variant={BackgroundVariant.Dots}
						gap={25}
						size={1.5}
						color="rgba(59,130,246,0.15)"
					/>
				</ReactFlow>
			</div>

			{selectedNode && (
				<ConfigPanel
					node={selectedNode}
					nodes={nodes}
					onClose={() => setSelectedNode(null)}
					onSave={saveConfig}
				/>
			)}

			<CreateStrategyModal
				key={showModal ? "open" : "closed"}
				open={showModal}
				loading={creating}
				onClose={() => setShowModal(false)}
				onCreate={createStrategy}
			/>
		</div>
	);
}

export default function BuilderPage() {
	return (
		<ReactFlowProvider>
			<Builder />
		</ReactFlowProvider>
	);
}
