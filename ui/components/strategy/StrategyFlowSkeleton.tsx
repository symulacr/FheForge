"use client";

import { motion } from "framer-motion";
import { Sparkles, Workflow } from "lucide-react";

export function StrategyFlowSkeleton() {
	return (
		<div className="relative overflow-hidden bg-card text-card-foreground border border-border p-5">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2 text-warning">
					<Workflow className="h-4 w-4" />
					<span className="text-sm font-semibold">Generating Strategy...</span>
				</div>
				<motion.div
					animate={{ rotate: 360 }}
					transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
				>
					<Sparkles className="h-4 w-4 text-accent" />
				</motion.div>
			</div>

			<div className="space-y-3 mb-4">
				{[1, 2, 3].map((index) => (
					<motion.div
						key={index}
						initial={{ opacity: 0, x: -20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ delay: index * 0.15, duration: 0.5 }}
						className="flex items-center gap-3 p-3 bg-secondary border border-border"
					>
						<div className="flex-shrink-0 w-6 h-6 bg-accent/10 border border-accent/20 flex items-center justify-center">
							<motion.div
								animate={{ scale: [1, 1.1, 1] }}
								transition={{
									duration: 1.5,
									repeat: Infinity,
									delay: index * 0.2,
								}}
								className="w-2 h-2 bg-accent/50"
							/>
						</div>

						<div className="flex-1 space-y-2">
							<motion.div
								animate={{ opacity: [0.3, 0.7, 0.3] }}
								transition={{
									duration: 1.5,
									repeat: Infinity,
									delay: index * 0.1,
								}}
								className="h-3 bg-border w-3/4"
							/>
							<motion.div
								animate={{ opacity: [0.2, 0.5, 0.2] }}
								transition={{
									duration: 1.8,
									repeat: Infinity,
									delay: index * 0.15,
								}}
								className="h-2 bg-border/50 w-1/2"
							/>
						</div>

						<motion.div
							animate={{ scale: [1, 1.05, 1] }}
							transition={{ duration: 2, repeat: Infinity, delay: index * 0.3 }}
							className="flex-shrink-0 w-6 h-6 bg-border"
						/>
					</motion.div>
				))}
			</div>

			<motion.div
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ delay: 0.6 }}
				className="flex items-center justify-between p-3 bg-secondary border border-border mb-4"
			>
				<div className="flex items-center gap-2">
					<motion.div
						animate={{ opacity: [0.3, 0.6, 0.3] }}
						transition={{ duration: 1.2, repeat: Infinity }}
						className="w-3 h-3 bg-border"
					/>
					<motion.div
						animate={{ opacity: [0.4, 0.7, 0.4] }}
						transition={{ duration: 1.4, repeat: Infinity }}
						className="h-3 w-20 bg-border"
					/>
				</div>
				<motion.div
					animate={{ opacity: [0.3, 0.6, 0.3] }}
					transition={{ duration: 1.6, repeat: Infinity }}
					className="h-3 w-12 bg-border"
				/>
			</motion.div>

			<motion.div
				initial={{ opacity: 0, scale: 0.95 }}
				animate={{ opacity: 1, scale: 1 }}
				transition={{ delay: 0.8 }}
				className="flex justify-center"
			>
				<div className="h-10 w-32 border border-accent/20 bg-accent/5" />
			</motion.div>

			<motion.div
				animate={{ x: [-100, 400] }}
				transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
				className="absolute inset-0 hidden"
				style={{ transform: "skewX(-20deg)" }}
			/>

			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: 1 }}
				className="absolute bottom-2 left-5 text-xs text-muted"
			>
				<motion.span
					animate={{ opacity: [0.4, 1, 0.4] }}
					transition={{ duration: 1.5, repeat: Infinity }}
				>
					Analyzing optimal strategy...
				</motion.span>
			</motion.div>
		</div>
	);
}
