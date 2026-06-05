import { plainToInstance } from 'class-transformer';
import { User } from 'src/users/domain/user.entity';
import type { CreateUserDto } from 'src/users/interfaces/dtos/create-user.dto';
import { UserDto } from 'src/users/interfaces/dtos/user.dto';
import { UserResponseDto } from 'src/users/interfaces/dtos/user-response.dto';

export function toUserDto(user: User): UserDto {
  return plainToInstance(UserDto, user, {
    excludeExtraneousValues: true,
  });
}

export function toUserResponse(user: User): UserResponseDto {
  return plainToInstance(UserResponseDto, user, {
    excludeExtraneousValues: true,
  });
}

export function toUserResponseList(users: User[]): UserResponseDto[] {
  return users.map((user) => toUserResponse(user));
}

export function toUserEntity(id: string, dto: CreateUserDto): User {
  return new User(id, dto.walletAddress, dto.chainId, dto.username);
}
