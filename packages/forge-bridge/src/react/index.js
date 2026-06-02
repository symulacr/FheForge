/**
 * Bridge React hooks — stubs for scaffold.
 * Full implementations will be added by the bridge-react feature worker.
 */

/**
 * @param {object} [_config] - Bridge configuration
 * @returns {object} Combined bridge state
 */
export function useBridge(_config) {
	return {
		wallet: { connected: false, address: "" },
		permit: { unlocked: false, secondsLeft: 0 },
	};
}

/** @returns {object} Wallet connection state and actions */
export const useWallet = () => ({ connected: false, address: "", isConnecting: false });

/** @returns {object} Permit state and grant action */
export const usePermit = () => ({ unlocked: false, secondsLeft: 0, grantPermit: async () => {} });

/** @returns {object} Market list state */
export const useMarkets = () => ({ status: "idle", data: null, error: null });

/** @returns {object} Protocol stats state */
export const useStats = () => ({ status: "idle", data: null, error: null });

/** @param {string} _address - User wallet address @returns {object} User positions state */
export const usePositions = (_address) => ({ status: "idle", data: [], error: null });

/** @param {object} [_filters] - Strategy filters @returns {object} Strategy list state */
export const useStrategies = (_filters) => ({ status: "idle", data: [], error: null });

/** @param {string} [_status] - Proposal status filter @returns {object} Governance proposals state */
export const useGovernanceProposals = (_status) => ({ status: "idle", data: [], error: null });

/** @returns {object} Governance vote action */
export const useGovernanceVote = () => ({ castVote: async (/** @type {any} */ _payload) => {} });

/** @returns {object} Builder simulation action */
export const useBuilderSimulate = () => ({
	simulate: async (/** @type {any} */ _nodes, /** @type {any} */ _edges) => {},
});

/** @returns {object} AI strategy builder action */
export const useBuilderAI = () => ({ build: async (/** @type {string} */ _prompt) => {} });

/** @returns {object} Deploy action */
export const useBuilderDeploy = () => ({ deploy: async (/** @type {any} */ _steps) => {} });

/** @returns {object} Estimate action */
export const useBuilderEstimate = () => ({ estimate: async (/** @type {any} */ _operation) => {} });

/** @returns {object} DeFi modules state */
export const useBuilderModules = () => ({ status: "idle", data: [], error: null });

/** @returns {object} FHE encrypt/decrypt helpers */
export const useFHE = () => ({
	encrypt: async (/** @type {any} */ _p) => null,
	decrypt: async (/** @type {any} */ _h) => null,
});

/** @param {string} _token - Token address @returns {object} LTV gauge state */
export const useLtvGauge = (_token) => ({ status: "idle", data: null, error: null });
