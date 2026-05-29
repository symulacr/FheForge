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
		// Note: workflow_graph expects nodes/edges structure, currently using steps array
		workflow_graph: workflowJson.steps ?? null,
	};

	return createStrategyWorkflow(payload);
};
