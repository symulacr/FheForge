"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmModalProps {
	open: boolean;
	title?: string;
	message: string;
	onConfirm: () => void;
	onCancel: () => void;
	loading?: boolean;
}

export default function ConfirmModal({
	open,
	title = "Delete Strategy",
	message,
	onConfirm,
	onCancel,
	loading = false,
}: ConfirmModalProps) {
	return (
		<Dialog open={open} onOpenChange={onCancel}>
			<DialogContent className="sm:max-w-[420px] bg-card border-border p-0 overflow-hidden">
				<div className="p-8">
					<DialogHeader className="flex flex-col items-center text-center space-y-4">
						<div className="w-16 h-16 bg-destructive/10 border border-destructive/30 flex items-center justify-center mb-2">
							<AlertTriangle className="w-8 h-8 text-destructive" />
						</div>

						<DialogTitle className="text-2xl font-bold text-foreground tracking-tight">
							{title}
						</DialogTitle>
					</DialogHeader>

					<div className="mt-4 text-center">
						<p className="text-[15px] text-muted-foreground leading-relaxed">{message}</p>
					</div>

					<div className="flex gap-3 mt-10">
						<Button
							variant="ghost"
							onClick={onCancel}
							disabled={loading}
							className="flex-1 h-12 bg-card hover:bg-secondary text-foreground border border-border"
						>
							Cancel
						</Button>

						<Button
							onClick={onConfirm}
							disabled={loading}
							className="flex-1 h-12 bg-destructive hover:bg-destructive/90 text-foreground font-bold flex items-center justify-center gap-2"
						>
							{loading ? (
								<div className="w-5 h-5 border-2 border-white/30 border-t-white animate-spin" />
							) : (
								<>
									<Trash2 size={18} />
									Delete
								</>
							)}
						</Button>
					</div>
				</div>
				<div className="h-px w-full bg-destructive/20" />
			</DialogContent>
		</Dialog>
	);
}
