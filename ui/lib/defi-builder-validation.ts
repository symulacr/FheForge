import { Action } from "@/types/defi";
import {
  canBeFirstStep,
  validateConnection,
} from "@/lib/defi-connection-rules";

import { Node } from "reactflow";
import { DefiNodeData } from "@/app/builder/components/nodes/defi-node.types";

export const isNodeConfigured = (node: Node<DefiNodeData>) => {
  const config = node?.data?.config;
  if (!config) return false;

  const operationType =
    (config as { operationType?: string; type?: string } | undefined)
      ?.operationType ||
    (config as { operationType?: string; type?: string } | undefined)?.type ||
    node?.data?.action?.operation_type;

  // SUPPLY nodes don't produce a tokenOutId
  if (operationType === "SUPPLY") {
    return Boolean(config?.tokenInId && config?.amount != null);
  }

  return Boolean(
    config?.tokenInId && config?.tokenOutId && config?.amount != null,
  );
};

export const validateAddNode = ({
  nodes,
  selectedNode,
  action,
}: {
  nodes: Node<DefiNodeData>[];
  selectedNode: Node<DefiNodeData> | null;
  action: Action;
}) => {
  const lastNode = nodes[nodes.length - 1];
  const newOperationType = action?.operation_type;

  if (!lastNode) {
    const firstStepResult = canBeFirstStep(newOperationType);

    if (!firstStepResult.valid) {
      return firstStepResult;
    }
  }

  if (
    lastNode &&
    !isNodeConfigured(lastNode) &&
    selectedNode?.id !== lastNode.id
  ) {
    return {
      valid: false,
      message:
        "Please configure and save the current step before adding another node.",
    };
  }

  if (lastNode) {
    const lastOperationType = lastNode?.data?.action?.operation_type;

    const connectionResult = validateConnection(
      lastOperationType,
      newOperationType,
    );

    if (!connectionResult.valid) {
      return connectionResult;
    }
  }

  return {
    valid: true,
    message: "",
  };
};
