"use client";

import { motion } from "framer-motion";

interface StrategyStepsSkeletonProps {
	stepCount?: number;
	compact?: boolean;
}

export function StrategyStepsSkeleton({
	stepCount = 3,
	compact = false,
}: StrategyStepsSkeletonProps) {
	return (
		<div className="space-y-3">
			{Array.from({ length: stepCount }).map((_, index) => (
				<motion.div
					key={index}
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: index * 0.1, duration: 0.4 }}
					className={`flex items-center gap-3 p-3 bg-white/[0.03] border border-white/10 ${
						compact ? "py-2" : "py-3"
					}`}
				>
					<div
						className={`flex-shrink-0 bg-accent/10 flex items-center justify-center ${
							compact ? "w-5 h-5" : "w-6 h-6"
						}`}
					>
						<motion.div
							animate={{ scale: [1, 1.1, 1] }}
							transition={{
								duration: 1.5,
								repeat: Infinity,
								delay: index * 0.2,
							}}
							className={`bg-accent/50 ${compact ? "w-1.5 h-1.5" : "w-2 h-2"}`}
						/>
					</div>

					<div className="flex-1 space-y-1.5">
						<motion.div
							animate={{ opacity: [0.3, 0.7, 0.3] }}
							transition={{
								duration: 1.5,
								repeat: Infinity,
								delay: index * 0.1,
							}}
							className={`bg-white/10 rounded ${compact ? "h-2.5 w-2/3" : "h-3 w-3/4"}`}
						/>
						{!compact && (
							<motion.div
								animate={{ opacity: [0.2, 0.5, 0.2] }}
								transition={{
									duration: 1.8,
									repeat: Infinity,
									delay: index * 0.15,
								}}
								className="h-2 bg-white/5 rounded w-1/2"
							/>
						)}
					</div>

					<motion.div
						animate={{ scale: [1, 1.05, 1] }}
						transition={{ duration: 2, repeat: Infinity, delay: index * 0.3 }}
						className={`flex-shrink-0 bg-white/10 ${compact ? "w-5 h-5" : "w-6 h-6"}`}
					/>

					{index < stepCount - 1 && (
						<motion.div
							animate={{ opacity: [0.3, 0.6, 0.3] }}
							transition={{
								duration: 1.2,
								repeat: Infinity,
								delay: index * 0.1,
							}}
							className={`flex-shrink-0 bg-white/10 rounded ${compact ? "w-3 h-3" : "w-4 h-4"}`}
						/>
					)}
				</motion.div>
			))}
		</div>
	);
}
