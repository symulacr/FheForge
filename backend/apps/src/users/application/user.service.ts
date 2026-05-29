import { Injectable, NotFoundException, NotImplementedException } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { User } from "../domain/user.entity";
import type { UserRepository } from "../domain/user.repository";
import type { CreateUserDto } from "../interfaces/dtos/create-user.dto";

@Injectable()
export class UserService {
	constructor(private readonly userRepo: UserRepository) {}

	async createUser(dto: CreateUserDto): Promise<User> {
		const id = this.generateId();
		const user = new User(id, dto.walletAddress, dto.chainId, dto.username);
		await this.userRepo.save(user);
		return user;
	}

	private generateId(): string {
		return uuidv4();
	}

	async getUser(id: string): Promise<User> {
		const user = await this.userRepo.findById(id);
		if (!user) {
			throw new NotFoundException("User not found");
		}
		return user;
	}

	async listUsers(): Promise<User[]> {
		return await this.userRepo.findAll();
	}

	async renameUsername(id: string, newUsername: string): Promise<User> {
		const user = await this.userRepo.findById(id);
		if (!user) {
			throw new NotFoundException("User not found");
		}
		user.changeUsername(newUsername);
		await this.userRepo.save(user);
		return user;
	}

	async checkEvmBinding(
		walletAddress: string,
	): Promise<{ isBound: boolean; evmAddress: string | null }> {
		const user = await this.userRepo.findByWalletAddress(walletAddress).catch(() => null);
		if (!user) {
			return { isBound: false, evmAddress: null };
		}
		return { isBound: true, evmAddress: walletAddress };
	}

	getUserTokenBalance(_account: string, _tokenId: string): never {
		throw new NotImplementedException(
			"On-chain balance lookup not implemented. Use wagmi useBalance on the frontend.",
		);
	}

	async getUserByWalletAddress(walletAddress: string): Promise<User> {
		const user = await this.userRepo.findByWalletAddress(walletAddress);
		if (!user) {
			throw new NotFoundException("User not found");
		}
		return user;
	}
}
