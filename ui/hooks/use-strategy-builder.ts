"use client";

// Lightweight, internal typings to improve type-safety without changing runtime behavior
// These interfaces replace many 'any' usages in the strategy builder flow.
interface StrategyResult {
  amount_out?: number;
  output_amount?: number;
  result_amount?: number;
  received_amount?: number;
  deposit_amount?: number;
  borrow_amount?: number;
  shares_out?: number;
  token_out_id?: string;
  output_token_id?: string;
  result_asset_id?: string;
  asset_id?: string;
  vault_token_id?: string;
  token_out_symbol?: string;
  output_token_symbol?: string;
  result_asset_symbol?: string;
  asset_symbol?: string;
  vault_token_symbol?: string;
}

interface StrategyConfig {
  nodeId: string;
  operationType?: string;
  estimate?: StrategyResult | null;
  tokenInPairId?: string;
  tokenOutPairId?: string;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  amountOut?: number | null;
  slippage?: number | null;
  apy?: number | null;
  ltv?: number | null;
}

interface DefiPair {
  token_in: { id: string; asset_id?: string };
  token_out: { id: string; asset_id?: string };
}

import {
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
} from "reactflow";
import { useCallback, useState } from "react";

import { Module, Action, CreateStrategyPayload } from "@/types/defi";
import {
  DefiNodeData,
  DefiEstimate,
} from "@/app/builder/components/nodes/defi-node.types";
import { displayToast } from "@/components/shared/toast-manager";
import { useUser } from "@/providers/user-provider";
import { useFheVault } from "@/hooks/use-fhe-vault";

import { validateAddNode } from "@/lib/defi-builder-validation";
import {
  createDefiNode,
  createDefiEdge,
  markLastNode,
} from "@/lib/defi-node-factory";
import { buildWorkflowJson } from "@/lib/defi-workflow-builder";
import { submitStrategy } from "@/services/defi-strategy-builder";
import { TOKEN_SYMBOL_MAP } from "@/utils/addresses";
import { useRouter } from "next/navigation";

type SaveConfigPayload = Omit<CreateStrategyPayload, "slippage" | "amountOut"> &
  StrategyConfig & {
    operationType?: string;

    // pair ids from ConfigPanel
    tokenInPairId?: string;
    tokenOutPairId?: string;

    // optional UI helpers
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    amountOut?: number | null;
    slippage?: number | null;
    apy?: number | null;
    ltv?: number | null;
  } & {
    // Allow additional properties from dynamic config
    [key: string]: unknown;
  };

const getEstimateAmountOut = (
  est: StrategyResult | undefined,
  fallbackAmount?: number,
) => {
  return (
    est?.amount_out ??
    est?.output_amount ??
    est?.result_amount ??
    est?.received_amount ??
    est?.deposit_amount ??
    est?.borrow_amount ??
    est?.shares_out ??
    fallbackAmount ??
    null
  );
};

const getEstimateOutputAssetId = (
  est: StrategyResult | undefined,
  payload: SaveConfigPayload,
) => {
  return (
    est?.token_out_id ||
    est?.output_token_id ||
    est?.result_asset_id ||
    est?.asset_id ||
    est?.vault_token_id ||
    payload?.tokenOutId ||
    payload?.tokenInId ||
    undefined
  );
};

const getEstimateOutputSymbol = (
  est: StrategyResult | undefined,
  payload: SaveConfigPayload,
) => {
  return (
    est?.token_out_symbol ||
    est?.output_token_symbol ||
    est?.result_asset_symbol ||
    est?.asset_symbol ||
    est?.vault_token_symbol ||
    payload?.tokenOutSymbol ||
    payload?.tokenInSymbol ||
    ""
  );
};

export type { SaveConfigPayload };

export function useDefiBuilder() {
  const { user } = useUser();
  const router = useRouter();
  const { openPosition } = useFheVault();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [selectedNode, setSelectedNode] = useState<Node<DefiNodeData> | null>(
    null,
  );
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);

  /*
   * DELETE NODE
   */
  const deleteNode = useCallback(
    (id: string) => {
      let deleted = false;
      let showError = false;

      setNodes((nds) => {
        const lastNode = nds[nds.length - 1];

        if (!lastNode || lastNode.id !== id) {
          showError = true;
          return nds;
        }

        deleted = true;

        const newNodes = nds.slice(0, -1);

        return markLastNode(newNodes);
      });

      if (showError) {
        displayToast("error", "Only the last node can be deleted.");
        return;
      }

      if (deleted) {
        setEdges((eds) =>
          eds.filter((edge) => edge.source !== id && edge.target !== id),
        );

        displayToast("success", "Node deleted successfully.");
      }
    },
    [setNodes, setEdges],
  );

  /*
   * ADD NODE
   */
  const addNode = useCallback(
    (module: Module, action: Action) => {
      let added = false;
      let showError = false;
      let errorMessage = "";

      setNodes((nds) => {
        const validation = validateAddNode({
          nodes: nds,
          selectedNode,
          action,
        });

        if (!validation.valid) {
          showError = true;
          errorMessage = validation.message;
          return nds;
        }

        const updatedNodes = nds.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isLastNode: false,
          },
        }));

        const newNode = createDefiNode({
          module,
          action,
          index: nds.length,
          onDelete: deleteNode,
        });

        added = true;

        if (updatedNodes.length > 0) {
          const prevNode = updatedNodes[updatedNodes.length - 1];
          setEdges((eds) => [...eds, createDefiEdge(prevNode.id, newNode.id)]);
        }

        return [...updatedNodes, newNode];
      });

      if (showError) {
        displayToast("error", errorMessage || "Invalid step flow.");
        return;
      }

      if (added) {
        displayToast("success", "Node added successfully.");
      }
    },
    [deleteNode, selectedNode, setNodes, setEdges],
  );

  /*
   * MANUAL CONNECT (optional)
   */
  const onConnect = useCallback(
    (params: Edge | Connection) => {
      setEdges((eds) => {
        const alreadyConnected = eds.some(
          (edge) => edge.source === params.source,
        );

        if (alreadyConnected) {
          return eds;
        }

        return addEdge(
          {
            ...params,
            type: "smoothstep",
            animated: true,
            style: {
              stroke: "#6366f1",
              strokeWidth: 2,
            },
          },
          eds,
        );
      });
    },
    [setEdges],
  );

  /*
   * SAVE CONFIG
   */

  const saveConfig = useCallback(
    async (payload: SaveConfigPayload) => {
      const currentNode = nodes.find((node) => node.id === payload.nodeId);
      const action = currentNode?.data?.action;
      const actionName =
        payload.operationType || action?.name?.toUpperCase?.() || "SWAP";

      try {
        const finalEstimate = payload.estimate ?? null;
        const estimateForCalc = finalEstimate ?? undefined;

        const rawTokenOutId = getEstimateOutputAssetId(
          estimateForCalc,
          payload,
        );

        let finalTokenInAssetId = payload.tokenInId;
        let finalTokenOutAssetId = rawTokenOutId;

        if (action?.defi_pairs) {
          const pairForIn = action.defi_pairs.find(
            (p: DefiPair) => p.token_in.id === payload.tokenInId,
          );
          if (pairForIn) finalTokenInAssetId = pairForIn.token_in.asset_id;

          const pairForOut = action.defi_pairs.find(
            (p: DefiPair) => p.token_out.id === rawTokenOutId,
          );
          if (pairForOut) finalTokenOutAssetId = pairForOut.token_out.asset_id;
        }

        const finalConfig = {
          ...payload,
          tokenInId: finalTokenInAssetId,
          tokenOutId: finalTokenOutAssetId,
          operationType: actionName,
          estimate: finalEstimate,
          amountOut: getEstimateAmountOut(estimateForCalc, payload.amount),
          tokenOutSymbol: getEstimateOutputSymbol(estimateForCalc, payload),
        };

        setNodes((nds) =>
          nds.map((node) =>
            node.id === payload.nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    config: finalConfig,
                    estimate: finalEstimate,
                  },
                }
              : node,
          ),
        );

        setSelectedNode((prev: Node<DefiNodeData> | null) =>
          prev && prev.id === payload.nodeId
            ? ({
                ...prev,
                data: {
                  ...prev.data,
                  config: finalConfig as DefiNodeData["config"],
                  estimate: finalEstimate as DefiEstimate | undefined,
                },
              } as Node<DefiNodeData>)
            : prev,
        );

        displayToast("success", "Configuration saved successfully.");
      } catch (error) {
        console.error("SAVE CONFIG ERROR:", error);
        displayToast("error", "Failed to save configuration.");
      }
    },
    [nodes, setNodes],
  );

  /*
   * CREATE STRATEGY
   */
  const createStrategy = useCallback(
    async (name: string) => {
      if (!user) {
        displayToast("error", "Please connect your wallet first.");
        return;
      }

      try {
        setCreating(true);

        const workflowJson = buildWorkflowJson(nodes);

        const record = await submitStrategy({
          userId: user.id,
          name,
          workflowJson,
        });

        // Persist strategyId so strategy-review page can read it
        if (record?.id) {
          const url = new URL(window.location.href);
          url.searchParams.set("strategyId", String(record.id));
          window.history.replaceState(null, "", url.toString());
        }

        // Wire to vault: extract amounts from node configs
        const supplyNode = nodes.find(
          (n) => n.data?.config?.operationType === "SUPPLY",
        );
        if (!supplyNode) {
          console.warn("No SUPPLY node found, skipping openPosition");
        } else {
          const joinNodes = nodes.filter(
            (n) => n.data?.config?.operationType === "JOIN_STRATEGY",
          );
          const supplyConfig = supplyNode.data.config;
          const collateralEth = String(supplyConfig.amount ?? "0");
          // F-03: apyTarget + loopCount no longer travel with openPosition.
          // They live as plaintext on the registry's Strategy struct and
          // should be set at `registerStrategy` time via the 4-arg overload
          // (or via the composer's atomic register+open flow). The values
          // computed below are kept for the `joinNodes`/apy display logic
          // upstream but intentionally not forwarded to the vault.
          void joinNodes;
          void supplyConfig.apy;
          const strategyId = typeof record?.id === "number" ? record.id : 0;
          const tokenSymbol =
            supplyConfig.tokenInSymbol?.toUpperCase() ?? "WETH";
          const collateralToken = TOKEN_SYMBOL_MAP[tokenSymbol]?.address;
          if (!collateralToken) {
            displayToast(
              "error",
              `No contract address for token ${tokenSymbol}. Set NEXT_PUBLIC_TOKEN_${tokenSymbol} env var.`,
            );
            return;
          }
          // non-blocking
          if (strategyId === 0) {
            console.warn("[FheForge] strategyId=0, skipping openPosition");
          } else {
            openPosition(
              collateralToken,
              collateralEth,
              collateralEth,
              BigInt(strategyId),
            ).catch((e: unknown) => console.warn("openPosition failed:", e));
          }
        }

        displayToast("success", "Strategy created successfully.");
        setShowModal(false);

        router.push("/strategy");
      } catch (error) {
        console.error(error);
        displayToast("error", "Failed to create strategy.");
      } finally {
        setCreating(false);
      }
    },
    [user, nodes, router, openPosition],
  );

  return {
    nodes,
    edges,

    selectedNode,
    showModal,
    creating,

    setSelectedNode,
    setShowModal,

    onNodesChange,
    onEdgesChange,
    onConnect,

    setEdges,

    addNode,
    deleteNode,
    saveConfig,
    createStrategy,
  };
}
