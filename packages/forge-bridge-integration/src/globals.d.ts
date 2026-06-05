/**
 * Global type declarations for browser globals used by the bridge integration layer.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-var */

interface Window {
	__MOCK__: Record<string, any>;
	__BRIDGE__: BridgeAPI;
	__bridgeBus: any;
	__transformers: TransformersAPI;
	DataFetcherV2: any;
	bridge: any;
	Landing: any;
	Dashboard: any;
	Lending: any;
	Market: any;
	Governance: any;
	ConnectModal: any;
	React: typeof React;
	ethereum: any;
}

interface BridgeAPI {
	setMockData(key: string, value: any): void;
	getMockData(key: string): any;
	onDataUpdate(fn: (data: any) => void): () => void;
	notify(): void;
	_listeners: Set<Function>;
	_dataVersion: number;
}

interface TransformersAPI {
	transformMarkets(apiMarkets: any[]): any[];
	transformPositions(supplies: any[], borrows: any[], markets: any[]): any[];
	transformActivities(apiActivities: any[]): any[];
	formatTicker(stats: Record<string, any>): string[];
	transformStrategies(apiStrategies: any[]): any[];
	transformProposals(apiProposals: any[]): any[];
	transformNodeTypes(modules: any[]): Record<string, any>;
	calculateNetValue(positions: any[]): string;
	calculateLTV(positions: any[]): { ratio: string; gaugeValue: number };
}

declare var Babel: {
	transform: (code: string, options?: any) => { code: string; map?: any; ast?: any };
	packages: {
		types: {
			identifier(name: string): any;
			stringLiteral(value: string): any;
			jsxExpressionContainer(expression: any): any;
			memberExpression(object: any, property: any, computed?: boolean): any;
		};
	};
};

declare module "bun:test" {
	export const describe: (name: string, fn: () => void) => void;
	export const it: (name: string, fn: () => void) => void;
	export const expect: (value: any) => any;
	export const beforeAll: (fn: () => void) => void;
	export const afterAll: (fn: () => void) => void;
}
