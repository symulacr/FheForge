/**
 * Global type declarations for browser globals used by the bridge integration layer.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-var */

interface Window {
	__MOCK__: Record<string, unknown>;
	__BRIDGE__: BridgeAPI;
	__bridgeBus: unknown;
	__transformers: TransformersAPI;
	DataFetcherV2: unknown;
	bridge: BridgeAPI;
	Landing: unknown;
	Dashboard: unknown;
	Lending: unknown;
	Market: unknown;
	Governance: unknown;
	ConnectModal: unknown;
	React: typeof React;
	ethereum: unknown;
}

interface BridgeAPI {
	setMockData(key: string, value: unknown): void;
	getMockData(key: string): unknown;
	onDataUpdate(fn: (data: unknown) => void): () => void;
	notify(): void;
	_listeners: Set<(...args: never) => unknown>;
	_dataVersion: number;
}

interface TransformersAPI {
	transformMarkets(apiMarkets: unknown[]): unknown[];
	transformPositions(supplies: unknown[], borrows: unknown[], markets: unknown[]): unknown[];
	transformActivities(apiActivities: unknown[]): unknown[];
	formatTicker(stats: Record<string, unknown>): string[];
	transformStrategies(apiStrategies: unknown[]): unknown[];
	transformProposals(apiProposals: unknown[]): unknown[];
	transformNodeTypes(modules: unknown[]): Record<string, unknown>;
	calculateNetValue(positions: unknown[]): string;
	calculateLTV(positions: unknown[]): { ratio: string; gaugeValue: number };
}

declare var Babel: {
	transform: (code: string, options?: unknown) => { code: string; map?: unknown; ast?: unknown };
	packages: {
		types: {
			identifier(name: string): unknown;
			stringLiteral(value: string): unknown;
			jsxExpressionContainer(expression: unknown): unknown;
			memberExpression(object: unknown, property: unknown, computed?: boolean): unknown;
		};
	};
};

declare module "bun:test" {
	export const describe: (name: string, fn: () => void) => void;
	export const it: (name: string, fn: () => void) => void;
	export const expect: (value: unknown) => unknown;
	export const beforeAll: (fn: () => void) => void;
	export const afterAll: (fn: () => void) => void;
}
