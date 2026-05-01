import dynamic from "next/dynamic";

const StrategyReviewClient = dynamic(() => import("./StrategyReviewClient"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-white animate-pulse">Loading strategy review...</div>
    </div>
  ),
});

export default function StrategyReviewPage() {
  return <StrategyReviewClient />;
}
