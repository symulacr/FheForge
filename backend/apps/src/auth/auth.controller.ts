import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthService } from "./auth.service";
import {
	NonceResponseDto,
	type WalletLoginDto,
	WalletLoginResponseDto,
} from "./dto/wallet-login.dto";
import { Public } from "./public.decorator";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Public()
	@Get("nonce/:walletAddress")
	@ApiOperation({ summary: "Get a nonce for wallet authentication" })
	@ApiParam({ name: "walletAddress", description: "Ethereum wallet address" })
	@ApiResponse({
		status: 200,
		description: "Nonce generated",
		type: NonceResponseDto,
	})
	async getNonce(@Param("walletAddress") walletAddress: string): Promise<NonceResponseDto> {
		return await this.authService.generateNonce(walletAddress);
	}

	@Public()
	@Post("wallet-login")
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: "Authenticate with wallet signature" })
	@ApiResponse({
		status: 200,
		description: "Login successful",
		type: WalletLoginResponseDto,
	})
	@ApiResponse({ status: 401, description: "Invalid signature or nonce" })
	async walletLogin(
		@Body() dto: WalletLoginDto,
		@Res({ passthrough: true }) res: Response,
	): Promise<WalletLoginResponseDto> {
		const result = await this.authService.login(
			dto.walletAddress,
			dto.signature,
			dto.nonce,
			dto.chainId,
		);
		res.cookie("auth_token", result.accessToken, {
			httpOnly: true,
			secure: true,
			sameSite: "strict",
			maxAge: 15 * 60 * 1000,
			path: "/",
		});
		return { userId: result.userId, walletAddress: result.walletAddress };
	}

	@Public()
	@Post("logout")
	@HttpCode(HttpStatus.OK)
	logout(@Res({ passthrough: true }) res: Response) {
		res.clearCookie("auth_token", {
			httpOnly: true,
			secure: true,
			sameSite: "strict",
			path: "/",
		});
		return { message: "Logged out" };
	}
}
