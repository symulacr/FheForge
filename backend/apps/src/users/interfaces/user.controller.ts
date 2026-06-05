import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { UserMapper } from '../application/mappers/user.mapper';
import { UserService } from '../application/user.service';
import type { CreateUserDto } from './dtos/create-user.dto';
import type { UpdateUsernameDto } from './dtos/update-username.dto';
import { UserResponseDto } from './dtos/user-response.dto';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({
    status: 201,
    description: 'User successfully created',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    const user = await this.userService.createUser(dto);
    return UserMapper.toResponse(user);
  }

  @Public()
  @Get('me')
  @ApiOperation({ summary: 'Get current user by wallet address' })
  @ApiQuery({
    name: 'address',
    required: false,
    description: 'Wallet address (alternative to header)',
  })
  @ApiHeader({
    name: 'x-wallet-address',
    required: false,
    description: 'Wallet address (alternative to query param)',
  })
  @ApiResponse({
    status: 200,
    description: 'User found',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Wallet address is required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getCurrentUser(
    @Query('address') queryAddress?: string,
    @Headers('x-wallet-address') headerAddress?: string,
  ): Promise<UserResponseDto> {
    const walletAddress = queryAddress || headerAddress;

    if (!walletAddress) {
      throw new BadRequestException(
        'Wallet address is required via query param ?address or header x-wallet-address',
      );
    }

    const user = await this.userService.getUserByWalletAddress(walletAddress);
    return UserMapper.toResponse(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'User found',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUser(@Param('id') id: string): Promise<UserResponseDto> {
    const user = await this.userService.getUser(id);
    return UserMapper.toResponse(user);
  }

  @Get()
  @ApiOperation({ summary: 'List all users' })
  @ApiResponse({
    status: 200,
    description: 'List of users',
    type: [UserResponseDto],
  })
  async listUsers(): Promise<UserResponseDto[]> {
    const users = await this.userService.listUsers();
    return UserMapper.toResponseList(users);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update the username of a user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Username updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  @HttpCode(HttpStatus.OK)
  async renameUsername(
    @Param('id') id: string,
    @Body() updateDto: UpdateUsernameDto,
  ): Promise<UserResponseDto> {
    const user = await this.userService.renameUsername(id, updateDto.username);
    return UserMapper.toResponse(user);
  }

  @Get('evm-binding/:address')
  @ApiOperation({ summary: 'Check if an address has a bound EVM account' })
  @ApiParam({ name: 'address', description: 'EVM wallet address' })
  @ApiResponse({ status: 200, description: 'Binding status returned' })
  async checkEvmBinding(
    @Param('address') address: string,
  ): Promise<{ isBound: boolean; evmAddress: string | null }> {
    return this.userService.checkEvmBinding(address);
  }

  @Get('balance/:address/:tokenId')
  @ApiOperation({ summary: 'Get token balance of an address' })
  @ApiParam({ name: 'address', description: 'EVM wallet address' })
  @ApiParam({ name: 'tokenId', description: 'Token ID to check balance' })
  @ApiResponse({ status: 200, description: 'Token balance returned' })
  getTokenBalance(
    @Param('address') address: string,
    @Param('tokenId') tokenId: string,
  ): number {
    return this.userService.getUserTokenBalance(address, tokenId);
  }
}
