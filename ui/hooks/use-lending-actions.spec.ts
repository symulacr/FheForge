import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useLendingActions } from "./use-lending-actions";

// Mock wagmi hooks
vi.mock("wagmi", () => ({
	useWriteContract: () => ({
		writeContractAsync: vi.fn().mockResolvedValue("0x123"),
		isPending: false,
	}),
	useChainId: () => 421614,
	usePublicClient: () => ({
		readContract: vi.fn().mockResolvedValue(true),
	}),
}));

// Mock CoFHE provider
vi.mock("@/providers/fhenix-provider", () => ({
	useCofheClient: () => ({
		encryptInputs: vi.fn().mockReturnValue({
			execute: vi
				.fn()
				.mockResolvedValue([{ ctHash: 1n, securityZone: 1, utype: 1, signature: "0x" }]),
		}),
	}),
	useCofheState: () => ({
		permitReady: true,
	}),
}));

// Mock addresses utility
vi.mock("@/utils/addresses", () => ({
	getContractAddresses: () => ({
		pool: "0x1234567890123456789012345678901234567890",
		oracle: "0x0987654321098765432109876543210987654321",
	}),
	validateEuint128: vi.fn(),
}));

describe("Lending Action Hooks (liquidateWithProof, borrow, oracle, isSupported)", () => {
	it("should export all required lending action functions", () => {
		const { result } = renderHook(() => useLendingActions());

		// liquidate removed — Pool has no liquidate function, only liquidateWithProof
		expect(typeof result.current.liquidateWithProof).toBe("function");

		// MC-37: borrowWithLtvCheck
		expect(typeof result.current.borrowWithLtvCheck).toBe("function");

		// MC-38: borrowWithOracle
		expect(typeof result.current.borrowWithOracle).toBe("function");

		// emergencyWithdraw moved to Vault hook — Pool has no emergencyWithdraw
		expect(typeof result.current.requestLiquidityCheck).toBe("function");

		// MC-45: isSupported
		expect(typeof result.current.isSupported).toBe("function");

		// Convenience wrappers
		expect(typeof result.current.borrowWithLtvCheckWithEncrypt).toBe("function");
		expect(typeof result.current.borrowWithOracleWithEncrypt).toBe("function");
		expect(typeof result.current.encrypt).toBe("function");
	});

	it("should provide encryption state", () => {
		const { result } = renderHook(() => useLendingActions());

		expect(typeof result.current.isEncrypting).toBe("boolean");
		expect(typeof result.current.isPending).toBe("boolean");
	});

	describe("MC-45: isSupported token check", () => {
		it("should check if token is supported by PriceOracle", async () => {
			const { result } = renderHook(() => useLendingActions());

			const tokenAddress = "0x1234567890123456789012345678901234567890";
			const isSupported = await result.current.isSupported(tokenAddress as `0x${string}`);

			expect(isSupported).toBe(true);
		});
	});

	describe("Convenience encryption wrappers", () => {
		it("should provide borrowWithLtvCheckWithEncrypt that combines encryption and borrow", async () => {
			const { result } = renderHook(() => useLendingActions());

			const collateralToken = "0x1234567890123456789012345678901234567890";
			const borrowToken = "0x0987654321098765432109876543210987654321";

			const tx = await result.current.borrowWithLtvCheckWithEncrypt(
				collateralToken as `0x${string}`,
				borrowToken as `0x${string}`,
				"1.0",
				18,
				75n,
				100n,
			);

			expect(tx).toBe("0x123");
		});

		it("should provide borrowWithOracleWithEncrypt that combines encryption and borrow", async () => {
			const { result } = renderHook(() => useLendingActions());

			const collateralToken = "0x1234567890123456789012345678901234567890";
			const borrowToken = "0x0987654321098765432109876543210987654321";

			const tx = await result.current.borrowWithOracleWithEncrypt(
				collateralToken as `0x${string}`,
				borrowToken as `0x${string}`,
				"1.0",
				"1.0",
				18,
			);

			expect(tx).toBe("0x123");
		});
	});
});
