import { Node } from "reactflow";
import { DefiNodeData } from "@/app/builder/components/nodes/defi-node.types";

export const buildWorkflowJson = (nodes: Node<DefiNodeData>[]) => {
  let stepNumber = 1;

  const steps = nodes.map((node, index) => {
    const config = node.data.config;

    if (!config) {
      throw new Error(
        `Node "${node.data?.action?.name ?? node.id}" has not been configured. Please configure all steps before building the workflow.`,
      );
    }

    if (index === 0 && config.tokenInId === "") {
      throw new Error(
        `Node "${node.data?.action?.name ?? node.id}" has an empty tokenInId`,
      );
    }

    let tokenIn;

    if (index === 0) {
      if (config?.tokenInId) {
        tokenIn = {
          assetId: config.tokenInId,
          symbol: config.tokenInSymbol,
          amount: config.amount,
        };
      }
    } else {
      const prevConfig = nodes[index - 1].data.config;

      if (prevConfig?.tokenOutId) {
        tokenIn = {
          assetId: prevConfig.tokenOutId,
          symbol: prevConfig.tokenOutSymbol,
          amount: prevConfig.amountOut,
        };
      }
    }

    let tokenOut;

    if (config?.tokenOutId) {
      tokenOut = {
        assetId: config.tokenOutId,
        symbol: config.tokenOutSymbol,
        amount: config.amountOut,
      };
    }

    return {
      step: stepNumber++,
      type: (node.data.action?.name ?? node.id)
        .toUpperCase()
        .replace(/\s+/g, "_"),
      agent: (node.data.module?.name ?? "UNKNOWN").toUpperCase(),
      tokenIn,
      tokenOut,
    };
  });

  const joinStrategyCount = nodes.filter(
    (node) => node.data?.action?.operation_type === "JOIN_STRATEGY",
  ).length;

  return {
    loops: String(joinStrategyCount || 1),
    fee: 0,
    steps,
  };
};
