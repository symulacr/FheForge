import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UserRepository } from '../domain/user.repository';
import { User } from '../domain/user.entity';
import { CreateUserDto } from '../interfaces/dtos/create-user.dto';
import { v4 as uuidv4 } from 'uuid';

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
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async listUsers(): Promise<User[]> {
    return await this.userRepo.findAll();
  }

  async renameUsername(id: string, newUsername: string): Promise<User> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.changeUsername(newUsername);
    await this.userRepo.save(user);
    return user;
  }

  checkEvmBinding(substrateAddress: string): {
    isBound: boolean;
    evmAddress: string;
  } {
    return { isBound: true, evmAddress: substrateAddress };
  }

  getUserTokenBalance(_account: string, _tokenId: string): never {
    throw new BadRequestException(
      'Use wagmi useBalance on the frontend instead of calling this endpoint',
    );
  }

  async getUserByWalletAddress(walletAddress: string): Promise<User> {
    const user = await this.userRepo.findByWalletAddress(walletAddress);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
