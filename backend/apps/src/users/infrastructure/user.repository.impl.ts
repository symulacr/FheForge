import { Injectable } from "@nestjs/common";
import type { UserRow } from "src/shared/infrastructure/database.types";
import type { SupabaseService } from "src/shared/infrastructure/supabase.service";
import { User } from "../domain/user.entity";
import type { UserRepository } from "../domain/user.repository";

@Injectable()
export class UserRepositoryImplement implements UserRepository {
	constructor(private readonly supabase: SupabaseService) {}

	async findById(id: string): Promise<User | null> {
		const { data, error } = await this.supabase
			.getClient()
			.from("users")
			.select("*")
			.eq("id", id)
			.single();

		if (error || !data) {
			return null;
		}

		return this.mapRowToEntity(data as UserRow);
	}

	async findByWalletAddress(walletAddress: string): Promise<User | null> {
		const { data, error } = await this.supabase
			.getClient()
			.from("users")
			.select("*")
			.eq("wallet_address", walletAddress)
			.single();

		if (error || !data) {
			return null;
		}

		return this.mapRowToEntity(data as UserRow);
	}

	async save(user: User): Promise<void> {
		const { error } = await this.supabase.getClient().from("users").upsert({
			id: user.id,
			wallet_address: user.walletAddress,
			chain_id: user.chainId,
			username: user.username,
		});

		if (error) {
			throw new Error(`Failed to save user: ${error.message}`);
		}
	}

	async findAll(): Promise<User[]> {
		const { data, error } = await this.supabase.getClient().from("users").select("*");

		if (error) {
			throw new Error(`Failed to fetch users: ${error.message}`);
		}

		return (data || []).map((row) => this.mapRowToEntity(row as UserRow));
	}

	private mapRowToEntity(row: UserRow): User {
		return new User(row.id, row.wallet_address, row.chain_id, row.username ?? undefined);
	}
}
