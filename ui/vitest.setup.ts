import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Provide jest-compatible globals for existing tests that use jest.mock / jest.fn
(globalThis as unknown as { jest: typeof vi }).jest = vi;

// Globally mock @cofhe/react to avoid ESM/MUI resolution issues in test environment
vi.mock("@cofhe/react", () => ({
	createCofheConfig: vi.fn(() => ({})),
	CofheProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@cofhe/react/styles.css", () => ({}));
