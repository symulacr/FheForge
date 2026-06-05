export class StrategyResponseDto {
	id: string;
	strategistName: string;
	strategistHandle?: string;
	apy: number;
	tags?: string[];
	assets?: string[];
	agents?: string[];
	chains?: string[];
	name?: string;
	description?: string;
	staked?: string;
	tvl?: string;
	loops?: number;
	depositors?: number;
	risk?: string;
	active?: boolean;
	template?: string;
	strategyAddress?: string;
	composerAddress?: string;
	minDeposit?: string;
	maxDeposit?: string;
	executorFeeBps?: number;
	createdAt?: Date;
	lastExecuted?: Date;
	deployerCount?: number;
}
