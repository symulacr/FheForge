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
	loading: () => (
		<div className="flex items-center justify-center h-full text-muted text-sm">
			Loading builder...
		</div>
	),
});

const ReactFlowProvider = dynamic(
	() => import("reactflow").then((mod) => mod.ReactFlowProvider),
	{ ssr: false }
);

const Background = dynamic(() => import("reactflow").then((mod) => mod.Background), {
	ssr: false,
});

const Controls = dynamic(() => import("reactflow").then((mod) => mod.Controls), {
	ssr: false,
});

const MiniMap = dynamic(() => import("reactflow").then((mod) => mod.MiniMap), {
	ssr: false,
});

function addEdge(params: Edge | Connection, edges: Edge[]) {
	const id = (params as Edge).id ?? `e${edges.length + 1}`;
	if (edges.find((e) => e.source === params.source && e.target === params.target)) {
		return edges;
	}
	return [...edges, { id, ...params } as Edge];
}

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
			displayToast("error", "Add at least one step before creating a strategy.");
			return false;
		}

		const hasUnconfigured = nodes.some((node) => !node.data?.config);
		if (hasUnconfigured) {
			displayToast("error", "Configure and save all steps before creating a strategy.");
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

		return validateConnection(sourceType, targetType).valid;
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
			(edge) => edge.source === connection.source && edge.target === connection.target
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
		<div className="flex flex-1 px-4 pb-4 pt-4 min-h-0 gap-4">
			{/* Sidebar */}
			<aside className="w-72 shrink-0 custom-scroll overflow-y-auto">
				<Sidebar modules={modules} onSelect={handleAddNode} />
			</aside>

			{/* Canvas */}
			<div className="flex-1 relative glass border border-border overflow-hidden">
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
					{/* Create Button */}
					<button
						onClick={() => {
							if (!validateWorkflow()) return;
							setShowModal(true);
						}}
						className="defi-btn-glass defi-create-btn"
						aria-label="Create strategy from current workflow"
					>
						Create Strategy
					</button>

					<MiniMap
						className="defi-minimap"
						style={{ width: 120, height: 80 }}
						aria-label="Workflow minimap"
					/>

					<Controls aria-label="Zoom controls" />

					<Background
						variant={BackgroundVariant.Dots}
						gap={24}
						size={1}
						color="var(--border)"
					/>
				</ReactFlow>
			</div>

			{/* Config Panel */}
			{selectedNode && (
				<ConfigPanel
					node={selectedNode}
					nodes={nodes}
					onClose={() => setSelectedNode(null)}
					onSave={saveConfig}
				/>
			)}

			{/* Create Modal */}
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
