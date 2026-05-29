"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/services/api";
import type { User } from "@/types/user.interface";

interface UserSignupDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: (user: User) => void;
}

export function UserSignupDialog({ open, onOpenChange, onSuccess }: UserSignupDialogProps) {
	const { address } = useAccount();
	const { signMessageAsync } = useSignMessage();
	const [username, setUsername] = useState("");
	const [isLoading, setIsLoading] = useState(false);

	const handleSignAndCreate = async () => {
		if (!address) {
			toast.error("Please connect your wallet first");
			return;
		}

		setIsLoading(true);

		try {
			const message = `Welcome to FheForge!\n\nWallet: ${address}\nTimestamp: ${new Date().toISOString()}`;

			const signature = await signMessageAsync({ message });

			const response = await api.post("/users", {
				walletAddress: address,
				chainId: 421614,
				username: username.trim() || undefined,
				signature,
			});

			const newUser: User = response.data;

			toast.success("Account created successfully!");
			onSuccess(newUser);
			onOpenChange(false);
		} catch (error: unknown) {
			console.error("Error creating user:", error);
			const axiosError = error as {
				response?: { data?: { message?: string } };
				message?: string;
			};
			toast.error(
				axiosError.response?.data?.message ||
					axiosError.message ||
					"Failed to create account. Please try again.",
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={() => {}}>
			<DialogContent
				className="sm:max-w-[500px] bg-card border-border"
				onPointerDownOutside={(e) => e.preventDefault()}
				onEscapeKeyDown={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="text-2xl font-bold text-foreground">
						Welcome to FheForge!
					</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						This is your first time connecting this wallet. Please sign a message to verify
						ownership and create your account.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="wallet-address" className="text-foreground">
							Wallet Address
						</Label>
						<Input
							id="wallet-address"
							value={address || ""}
							disabled
							className="font-mono text-sm bg-input border-border text-muted-foreground"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="username" className="text-foreground">
							Display Name <span className="text-muted">(optional)</span>
						</Label>
						<Input
							id="username"
							placeholder="Enter your name"
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							maxLength={50}
							className="bg-input border-border text-foreground placeholder:text-muted focus:border-accent"
						/>
						<p className="text-xs text-muted">You can change this later</p>
					</div>

					<div className="bg-card border border-border p-4 space-y-2">
						<p className="text-sm font-medium text-accent">You will need to:</p>
						<ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
							<li>Sign a message to verify wallet ownership</li>
							<li>No gas fees required for signing</li>
							<li>Your information is stored securely</li>
						</ul>
					</div>
				</div>

				<DialogFooter>
					<Button
						onClick={handleSignAndCreate}
						disabled={isLoading}
						className="w-full bg-accent hover:bg-accent/90 text-white"
					>
						{isLoading ? (
							<span className="flex items-center gap-2">
								<div className="h-4 w-4 animate-spin border-2 border-white border-t-transparent" />
								Processing...
							</span>
						) : (
							"Sign & Create Account"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
