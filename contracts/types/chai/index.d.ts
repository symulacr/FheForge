declare module "chai" {
	export const expect: Chai.ExpectStatic;
}

declare namespace Chai {
	type ExpectStatic = (...args: unknown[]) => Assertion;
	interface Assertion {
		to: Assertion;
		be: Assertion;
		deep: Assertion;
		equal(val: unknown): Assertion;
		eql(val: unknown): Assertion;
		[property: string]: unknown;
	}
}
