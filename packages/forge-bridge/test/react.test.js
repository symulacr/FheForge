/**
 * @file Unit tests for src/react/index.js — React hooks.
 *
 * Tests verify each hook's initial state, state transitions (loading → data/error),
 * action methods calling correct adapter methods, and cleanup on unmount.
 *
 * Uses JSDOM for React rendering and module mocking for adapters.
 */

import { mock, test, expect, describe, beforeEach, afterEach } from "bun:test";
import { JSDOM } from "jsdom";

// --------------------------------------------------------------------------
// JSDOM setup
// --------------------------------------------------------------------------
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
	url: "http://localhost",
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;

// --------------------------------------------------------------------------
// Mock the hub module
// --------------------------------------------------------------------------

let mockBridge = null;

function resetMockBridge() {
	mockBridge = {
		wallet: {
			connect: mock(() => Promise.resolve({ accounts: ["0xabc"] })),
			disconnect: mock(() => Promise.resolve()),
			login: mock(() =>
				Promise.resolve({ accessToken: "mock-jwt", userId: "user1", walletAddress: "0xabc" }),
			),
			logout: mock(() => Promise.resolve()),
			switchNetwork: mock(() => Promise.resolve()),
			getAccount: mock(() => "0xabc"),
			getChainId: mock(() => 421614),
			isConnected: mock(() => true),
			getJwt: mock(() => "mock-jwt"),
			refreshJwt: mock(() =>
				Promise.resolve({ accessToken: "new-jwt", userId: "user1", walletAddress: "0xabc" }),
			),
			onChainChange: mock(() => mock(() => {})),
		},
		fhe: {
			permitGrant: mock(() => Promise.resolve({ unlocked: true, secondsLeft: 900 })),
			grantPermit: mock(() => Promise.resolve({ unlocked: true, secondsLeft: 900 })),
			permitCheck: mock(() => ({ unlocked: true, secondsLeft: 850 })),
			checkPermit: mock(() => ({ unlocked: true, secondsLeft: 850 })),
			permitCountdown: mock(() => 850),
			encrypt: mock((plaintext) =>
				Promise.resolve({ handle: `0x_enc_${plaintext}`, type: "InEuint128" }),
			),
			decrypt: mock((handle) => Promise.resolve(`decrypted_${handle}`)),
			onPermitChange: mock(() => mock(() => {})),
			staggeredReveal: {
				getAdapter: mock(() => ({})),
				revealAll: mock((h) => Promise.resolve(h)),
				revealOne: mock((h) => Promise.resolve(h)),
			},
		},
		api: {
			markets: {
				getMarkets: mock(() =>
					Promise.resolve({
						status: "success",
						data: [{ id: "eth", apy: 5.2 }],
						error: null,
					}),
				),
			},
			stats: {
				getStats: mock(() =>
					Promise.resolve({
						status: "success",
						data: { tvl: 1000000, totalBorrowed: 500000 },
						error: null,
					}),
				),
			},
			strategies: {
				listStrategies: mock((_params) =>
					Promise.resolve({
						status: "success",
						data: [{ id: "strat1", name: "Yield Max" }],
						error: null,
					}),
				),
			},
			governance: {
				listProposals: mock((_params) =>
					Promise.resolve({
						status: "success",
						data: [{ id: "prop1", title: "Upgrade Pool" }],
						error: null,
					}),
				),
				castVote: mock((_data) =>
					Promise.resolve({ status: "success", data: { txHash: "0xvote" }, error: null }),
				),
			},
			defiModules: {
				getDefiModules: mock(() =>
					Promise.resolve({
						status: "success",
						data: [{ id: "module1", name: "Lending" }],
						error: null,
					}),
				),
			},
			defiStrategies: {
				createDefiStrategy: mock((_data) =>
					Promise.resolve({ status: "success", data: { id: "new-strategy" }, error: null }),
				),
				simulateDefiStrategy: mock((_data) =>
					Promise.resolve({
						status: "success",
						data: { apy: 12.5, risk: "low" },
						error: null,
					}),
				),
			},
			aiBuilder: {
				buildStrategy: mock((_data) =>
					Promise.resolve({
						status: "success",
						data: { nodes: [], edges: [] },
						error: null,
					}),
				),
			},
		},
		contract: {
			lendingPool: {
				getSupplyBalance: mock(() => Promise.resolve("1000000000000000000")),
				getBorrowBalance: mock(() => Promise.resolve("500000000000000000")),
			},
		},
		getState: mock(() => ({
			status: "success",
			data: {
				wallet: {
					address: "0xabc",
					chainId: 421614,
					connected: true,
					hasJwt: true,
				},
				fhe: { permitUnlocked: true, permitSecondsLeft: 850 },
				config: { apiBaseUrl: "https://api.test" },
			},
			error: null,
		})),
	};
}

resetMockBridge();

mock.module("../src/hub.js", () => ({
	createBridge: mock((_config) => mockBridge),
}));

// --------------------------------------------------------------------------
// Imports
// --------------------------------------------------------------------------
import { createElement } from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

import {
	BridgeProvider,
	useBridge,
	useWallet,
	usePermit,
	useMarkets,
	useStats,
	usePositions,
	useStrategies,
	useGovernanceProposals,
	useGovernanceVote,
	useBuilderSimulate,
	useBuilderAI,
	useBuilderDeploy,
	useBuilderEstimate,
	useBuilderModules,
	useFHE,
	useLtvGauge,
} from "../src/react/index.js";

// --------------------------------------------------------------------------
// Helper: render hook and capture state
// --------------------------------------------------------------------------

/**
 * Render a hook inside BridgeProvider and capture its return value into stateRef.
 */
function renderHookWithBridge(useHook, args, stateRef) {
	const container = document.createElement("div");

	function HookWrapper() {
		const state = useHook(...(args || []));
		stateRef.current = state;
		return null;
	}

	act(() => {
		ReactDOM.render(
			createElement(
				BridgeProvider,
				{ config: { apiBaseUrl: "https://api.test", chainId: 421614, rpcUrl: "https://rpc.test" } },
				createElement(HookWrapper),
			),
			container,
		);
	});

	return container;
}

/**
 * Render a component inside BridgeProvider.
 */
function renderInBridge(element) {
	const container = document.createElement("div");
	act(() => {
		ReactDOM.render(
			createElement(
				BridgeProvider,
				{ config: { apiBaseUrl: "https://api.test", chainId: 421614, rpcUrl: "https://rpc.test" } },
				element,
			),
			container,
		);
	});
	return container;
}

// --------------------------------------------------------------------------
// VAL-BRIDGE-REACT-001: All hooks are exported
// --------------------------------------------------------------------------

describe("VAL-BRIDGE-REACT-001 — All hooks exported", () => {
	test("exports useBridge", () => expect(useBridge).toBeDefined());
	test("exports useWallet", () => expect(useWallet).toBeDefined());
	test("exports usePermit", () => expect(usePermit).toBeDefined());
	test("exports useMarkets", () => expect(useMarkets).toBeDefined());
	test("exports useStats", () => expect(useStats).toBeDefined());
	test("exports usePositions", () => expect(usePositions).toBeDefined());
	test("exports useStrategies", () => expect(useStrategies).toBeDefined());
	test("exports useGovernanceProposals", () => expect(useGovernanceProposals).toBeDefined());
	test("exports useGovernanceVote", () => expect(useGovernanceVote).toBeDefined());
	test("exports useBuilderSimulate", () => expect(useBuilderSimulate).toBeDefined());
	test("exports useBuilderAI", () => expect(useBuilderAI).toBeDefined());
	test("exports useBuilderDeploy", () => expect(useBuilderDeploy).toBeDefined());
	test("exports useBuilderEstimate", () => expect(useBuilderEstimate).toBeDefined());
	test("exports useBuilderModules", () => expect(useBuilderModules).toBeDefined());
	test("exports useFHE", () => expect(useFHE).toBeDefined());
	test("exports useLtvGauge", () => expect(useLtvGauge).toBeDefined());
	test("exports BridgeProvider", () => expect(BridgeProvider).toBeDefined());
});

// --------------------------------------------------------------------------
// VAL-BRIDGE-REACT-002: Each hook returns { loading, data, error } state shape
// --------------------------------------------------------------------------

describe("VAL-BRIDGE-REACT-002 — Hook state shape has loading/data/error", () => {
	test("useBridge returns hub with wallet, api, contract, fhe, getState", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBridge, [{ apiBaseUrl: "https://api.test" }], stateRef);

		const hub = stateRef.current;
		expect(hub).toBeDefined();
		expect(hub.wallet).toBeDefined();
		expect(hub.api).toBeDefined();
		expect(hub.contract).toBeDefined();
		expect(hub.fhe).toBeDefined();
		expect(typeof hub.getState).toBe("function");
	});

	test("useBridge returns hub with getState returning BridgeState", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBridge, [{ apiBaseUrl: "https://api.test" }], stateRef);

		const hub = stateRef.current;
		const state = hub.getState();
		expect(state).toBeDefined();
		expect(state.status).toBe("success");
		expect(state.data.wallet).toBeDefined();
		expect(state.data.wallet.connected).toBe(true);
		expect(state.data.wallet.address).toBe("0xabc");
	});

	test("useWallet returns { loading, data, error } shape with actions", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useWallet, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.connect).toBe("function");
		expect(typeof result.disconnect).toBe("function");
		expect(typeof result.login).toBe("function");
		expect(typeof result.logout).toBe("function");
		expect(typeof result.switchNetwork).toBe("function");
	});

	test("usePermit returns { loading, data, error } shape with grantPermit", () => {
		const stateRef = { current: null };
		renderHookWithBridge(usePermit, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.grantPermit).toBe("function");
	});

	test("useMarkets returns { loading, data, error } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useMarkets, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
	});

	test("useStats returns { loading, data, error } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useStats, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
	});

	test("usePositions returns { loading, data, error } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(usePositions, ["0xabc"], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
	});

	test("useStrategies returns { loading, data, error } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useStrategies, [{}], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
	});

	test("useGovernanceProposals returns { loading, data, error } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useGovernanceProposals, ["active"], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
	});

	test("useGovernanceVote returns { loading, data, error, castVote } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useGovernanceVote, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.castVote).toBe("function");
	});

	test("useBuilderSimulate returns { loading, data, error, simulate } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBuilderSimulate, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.simulate).toBe("function");
	});

	test("useBuilderAI returns { loading, data, error, build } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBuilderAI, [], stateRef);

		const result = stateRef.current;
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.build).toBe("function");
	});

	test("useBuilderDeploy returns { loading, data, error, deploy } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBuilderDeploy, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.deploy).toBe("function");
	});

	test("useBuilderEstimate returns { loading, data, error, estimate } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBuilderEstimate, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.estimate).toBe("function");
	});

	test("useBuilderModules returns { loading, data, error } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBuilderModules, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
	});

	test("useFHE returns { loading, data, error, encrypt, decrypt } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useFHE, [], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
		expect(typeof result.encrypt).toBe("function");
		expect(typeof result.decrypt).toBe("function");
	});

	test("useLtvGauge returns { loading, data, error } shape", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useLtvGauge, ["0xtoken"], stateRef);

		const result = stateRef.current;
		expect(result).toBeDefined();
		expect("loading" in result).toBe(true);
		expect("data" in result).toBe(true);
		expect("error" in result).toBe(true);
	});
});

// --------------------------------------------------------------------------
// Hook behavior tests
// --------------------------------------------------------------------------

describe("useWallet — wallet state and actions", () => {
	beforeEach(() => resetMockBridge());

	test("tracks connected/address/chainId state", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useWallet, [], stateRef);

		const result = stateRef.current;
		expect(result.data).toBeDefined();
		expect(result.data.connected).toBe(true);
		expect(result.data.address).toBe("0xabc");
		expect(result.data.chainId).toBe(421614);
		expect(result.data.hasJwt).toBe(true);
	});

	test("connect action calls wallet.connect", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useWallet, [], stateRef);

		await act(async () => {
			await stateRef.current.connect("metaMask");
		});

		expect(mockBridge.wallet.connect).toHaveBeenCalledTimes(1);
		expect(mockBridge.wallet.connect).toHaveBeenCalledWith("metaMask");

		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});

	test("login action calls wallet.login", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useWallet, [], stateRef);

		await act(async () => {
			await stateRef.current.login();
		});

		expect(mockBridge.wallet.login).toHaveBeenCalledTimes(1);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});

	test("disconnect action calls wallet.disconnect", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useWallet, [], stateRef);

		await act(async () => {
			await stateRef.current.disconnect();
		});

		expect(mockBridge.wallet.disconnect).toHaveBeenCalledTimes(1);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("usePermit — permit state and grant", () => {
	beforeEach(() => resetMockBridge());

	test("returns permit state with unlocked/secondsLeft", () => {
		const stateRef = { current: null };
		renderHookWithBridge(usePermit, [], stateRef);

		const result = stateRef.current;
		expect(result.data).toBeDefined();
		expect(result.data.unlocked).toBe(true);
		expect(typeof result.data.secondsLeft).toBe("number");
	});

	test("grantPermit calls fhe.permitGrant", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(usePermit, [], stateRef);

		await act(async () => {
			await stateRef.current.grantPermit();
		});

		expect(mockBridge.fhe.permitGrant).toHaveBeenCalledTimes(1);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useMarkets — market list with auto-refresh", () => {
	beforeEach(() => resetMockBridge());

	test("fetches markets on mount and returns data", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useMarkets, [], stateRef);

		// Wait for async fetch to complete
		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		expect(mockBridge.api.markets.getMarkets).toHaveBeenCalledTimes(1);
		expect(stateRef.current.loading).toBe(false);
		expect(stateRef.current.data).toBeDefined();

		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});

	test("refresh action calls getMarkets again", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useMarkets, [], stateRef);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		await act(async () => {
			stateRef.current.refresh();
			await new Promise((r) => setTimeout(r, 50));
		});

		expect(mockBridge.api.markets.getMarkets.mock.calls.length).toBe(2);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useStats — protocol stats", () => {
	beforeEach(() => resetMockBridge());

	test("fetches stats on mount", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useStats, [], stateRef);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		expect(mockBridge.api.stats.getStats).toHaveBeenCalledTimes(1);
		expect(stateRef.current.loading).toBe(false);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("usePositions — user positions", () => {
	beforeEach(() => resetMockBridge());

	test("fetches supply and borrow positions on mount", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(usePositions, ["0xabc"], stateRef);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 100));
		});

		expect(mockBridge.contract.lendingPool.getSupplyBalance).toHaveBeenCalled();
		expect(mockBridge.contract.lendingPool.getBorrowBalance).toHaveBeenCalled();
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useStrategies — strategy list", () => {
	beforeEach(() => resetMockBridge());

	test("fetches strategies with filters", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useStrategies, [{ tags: ["yield"] }], stateRef);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		expect(mockBridge.api.strategies.listStrategies).toHaveBeenCalledTimes(1);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useGovernanceProposals — proposal list", () => {
	beforeEach(() => resetMockBridge());

	test("fetches proposals with status filter", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useGovernanceProposals, ["active"], stateRef);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		expect(mockBridge.api.governance.listProposals).toHaveBeenCalledTimes(1);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useGovernanceVote — cast vote action", () => {
	beforeEach(() => resetMockBridge());

	test("castVote calls governance.castVote with correct params", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useGovernanceVote, [], stateRef);

		await act(async () => {
			await stateRef.current.castVote("prop1", true, 100);
		});

		expect(mockBridge.api.governance.castVote).toHaveBeenCalledWith({
			proposalId: "prop1",
			support: true,
			votes: 100,
		});
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useBuilderSimulate — simulate strategy", () => {
	beforeEach(() => resetMockBridge());

	test("simulate calls defiStrategies.simulateDefiStrategy", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useBuilderSimulate, [], stateRef);

		await act(async () => {
			await stateRef.current.simulate([{ id: "1" }], [{ id: "e1" }]);
		});

		expect(mockBridge.api.defiStrategies.simulateDefiStrategy).toHaveBeenCalledWith({
			nodes: [{ id: "1" }],
			edges: [{ id: "e1" }],
		});
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useBuilderAI — AI strategy build", () => {
	beforeEach(() => resetMockBridge());

	test("build calls aiBuilder.buildStrategy with prompt", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useBuilderAI, [], stateRef);

		await act(async () => {
			await stateRef.current.build("Create a yield strategy");
		});

		expect(mockBridge.api.aiBuilder.buildStrategy).toHaveBeenCalledWith({
			prompt: "Create a yield strategy",
		});
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useBuilderDeploy — deploy strategy", () => {
	beforeEach(() => resetMockBridge());

	test("deploy calls defiStrategies.createDefiStrategy", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useBuilderDeploy, [], stateRef);

		const steps = [{ action: "deposit", token: "ETH", amount: "1.0" }];

		await act(async () => {
			await stateRef.current.deploy(steps);
		});

		expect(mockBridge.api.defiStrategies.createDefiStrategy).toHaveBeenCalledWith({ steps });
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useBuilderEstimate — estimate operation", () => {
	beforeEach(() => resetMockBridge());

	test("estimate calls simulateDefiStrategy with estimate flag", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useBuilderEstimate, [], stateRef);

		const operation = { type: "deposit", amount: "1000" };

		await act(async () => {
			await stateRef.current.estimate(operation);
		});

		expect(mockBridge.api.defiStrategies.simulateDefiStrategy).toHaveBeenCalledWith({
			operation,
			estimate: true,
		});
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useBuilderModules — DeFi modules list", () => {
	beforeEach(() => resetMockBridge());

	test("fetches modules on mount", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useBuilderModules, [], stateRef);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		expect(mockBridge.api.defiModules.getDefiModules).toHaveBeenCalledTimes(1);
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useFHE — encrypt/decrypt helpers", () => {
	beforeEach(() => resetMockBridge());

	test("encrypt calls fhe.encrypt", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useFHE, [], stateRef);

		await act(async () => {
			await stateRef.current.encrypt("1000", "0xtoken");
		});

		expect(mockBridge.fhe.encrypt).toHaveBeenCalledWith("1000", "0xtoken");
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});

	test("decrypt calls fhe.decrypt", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useFHE, [], stateRef);

		await act(async () => {
			await stateRef.current.decrypt("0xencrypted_handle");
		});

		expect(mockBridge.fhe.decrypt).toHaveBeenCalledWith("0xencrypted_handle");
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

describe("useLtvGauge — LTV calculation", () => {
	beforeEach(() => resetMockBridge());

	test("fetches LTV data for a token", async () => {
		const stateRef = { current: null };
		const container = renderHookWithBridge(useLtvGauge, ["0xtoken"], stateRef);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 100));
		});

		expect(mockBridge.contract.lendingPool.getSupplyBalance).toHaveBeenCalled();
		expect(mockBridge.contract.lendingPool.getBorrowBalance).toHaveBeenCalled();
		act(() => { ReactDOM.unmountComponentAtNode(container); });
	});
});

// --------------------------------------------------------------------------
// VAL-BRIDGE-REACT-003: useBridge returns combined context
// --------------------------------------------------------------------------

describe("VAL-BRIDGE-REACT-003 — useBridge returns combined context", () => {
	beforeEach(() => resetMockBridge());

	test("useBridge returns hub with wallet + fhe state via getState", () => {
		const stateRef = { current: null };
		renderHookWithBridge(useBridge, [{ apiBaseUrl: "https://api.test" }], stateRef);

		const hub = stateRef.current;
		const state = hub.getState();

		expect(state.data.wallet).toBeDefined();
		expect(state.data.wallet.connected).toBe(true);
		expect(state.data.wallet.address).toBe("0xabc");
		expect(state.data.fhe).toBeDefined();
		expect(state.data.fhe.permitUnlocked).toBe(true);
	});

	test("BridgeProvider wraps children with context", () => {
		const stateRef = { current: null };

		function ChildComponent() {
			const hub = useBridge();
			stateRef.current = hub;
			return null;
		}

		renderInBridge(createElement(ChildComponent));

		expect(stateRef.current).toBeDefined();
		expect(stateRef.current.wallet).toBeDefined();
		expect(stateRef.current.getState).toBeDefined();
	});
});

// --------------------------------------------------------------------------
// Cleanup on unmount
// --------------------------------------------------------------------------

describe("Hooks clean up on unmount", () => {
	beforeEach(() => resetMockBridge());

	test("useMarkets clears interval on unmount", async () => {
		const stateRef = { current: null };
		let callsBeforeUnmount = 0;

		function TestComponent() {
			const result = useMarkets(100);
			stateRef.current = result;
			return null;
		}

		const container = renderInBridge(createElement(TestComponent));

		// Let first fetch complete
		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		callsBeforeUnmount = mockBridge.api.markets.getMarkets.mock.calls.length;
		expect(callsBeforeUnmount).toBe(1);

		// Unmount
		act(() => {
			ReactDOM.unmountComponentAtNode(container);
		});

		// Wait — interval should have been cleared, no more calls
		await act(async () => {
			await new Promise((r) => setTimeout(r, 200));
		});

		expect(mockBridge.api.markets.getMarkets.mock.calls.length).toBe(callsBeforeUnmount);
	});
});
