import { DefiOperationType } from "@/app/builder/components/nodes/defi-node.types";
import { CreateStrategyRequest } from "@/types/defi";
import { DefiStrategy } from "@/types/defi.strategy";
import { SLIPPAGE_TOLERANCE } from "@/lib/constants";
import { api } from "@/services/api";

export const getDefiModules = async () => {
  const res = await api.get("/defi-modules");
  return res.data;
};

export const createDefiModule = async (data: unknown) => {
  const res = await api.post("/defi-modules", data);
  return res.data;
};

export type EstimateDefiOperationPayload = {
  operation_type: DefiOperationType;
  token_in_id?: string;
  token_out_id?: string;
  amount_in?: number;
  module_id?: string;
  action_id?: string;
};

export const estimateDefiOperation = async (
  data: EstimateDefiOperationPayload,
) => {
  const res = await api.post("/defi-modules/pairs/estimate", data);
  return res.data;
};

export const createStrategyWorkflow = async (
  payload: CreateStrategyRequest,
) => {
  const res = await api.post("/defi-strategies", payload);
  return res.data;
};

export const getStrategies = async (): Promise<DefiStrategy[]> => {
  const res = await api.get("/defi-strategies");
  return res.data;
};

export const getStrategiesByOwner = async (
  ownerId: string,
  signal?: AbortSignal,
) => {
  const res = await api.get(`/defi-strategies?owner=${ownerId}`, {
    signal,
  });
  return res.data;
};

export const simulateStrategy = async (strategyId: string, amount: number) => {
  const res = await api.post(`/defi-strategies/${strategyId}/simulate`, {
    amount_in: amount,
    slippage_tolerance: SLIPPAGE_TOLERANCE,
  });
  return res.data;
};

export const deleteStrategy = async (id: string) => {
  await api.delete(`/defi-strategies/${id}`);
  return true;
};

export const getRequiredActionData = async (actionId: string) => {
  const res = await api.get(
    `/defi-modules/actions/required?action_id=${actionId}`,
  );
  return res.data;
};
