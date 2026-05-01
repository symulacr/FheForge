import { createStrategyWorkflow } from "@/services/defi-module-service";

export const submitStrategy = async ({
  userId,
  name,
  description = "Strategy description",
  workflowJson,
}: {
  userId: string;
  name: string;
  description?: string;
  workflowJson: { steps: unknown[] };
}) => {
  const payload = {
    owner_id: userId,
    name,
    description,
    is_public: true,
    chain_context: "Fhenix",
    status: "draft",
    workflow_json: workflowJson,
    // TODO: verify backend schema — workflow_graph expects a graph structure (nodes/edges)
    // rather than a flat steps array. Update serialization once the contract is confirmed.
    workflow_graph: workflowJson.steps ?? null,
  };

  return createStrategyWorkflow(payload);
};
