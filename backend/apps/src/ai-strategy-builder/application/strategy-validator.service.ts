import { Injectable, Logger } from '@nestjs/common';
import { StrategyStepResponseDto } from '../interfaces/dtos/strategy-step-response.dto';
import { DefiPairsService } from '../../defi_modules/application/defi_pairs.service';
import { DefiTokenService } from '../../defi_token/application/defi_token.service';
import { OperationType } from '../../defi_modules/domain/operation-type.enum';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class StrategyValidatorService {
  private readonly logger = new Logger(StrategyValidatorService.name);

  constructor(
    private readonly defiPairsService: DefiPairsService,
    private readonly defiTokenService: DefiTokenService,
  ) {}

  async validateSteps(steps: StrategyStepResponseDto[]): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    this.logger.log('Starting strategy validation', {
      stepCount: steps.length,
    });

    const errors: string[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (!step.type || !step.agent) {
        errors.push(`Step ${i + 1}: Missing required fields (type, agent)`);
        continue;
      }

      if (!this.isValidOperationType(step.type)) {
        errors.push(`Step ${i + 1}: Invalid operation type '${step.type}'`);
        continue;
      }

      if (this.requiresTokenValidation(step.type)) {
        const pairValidation = await this.validateTokenPair(step);
        if (!pairValidation.isValid) {
          errors.push(`Step ${i + 1}: ${pairValidation.error}`);
        }
      }

      if (i > 0) {
        const sequenceValidation = this.validateSequence(steps[i - 1], step);
        if (!sequenceValidation.isValid) {
          warnings.push(`Step ${i + 1}: ${sequenceValidation.warning}`);
        }
      }

      if (step.tokenIn?.amount && step.tokenIn.amount <= 0) {
        errors.push(`Step ${i + 1}: Invalid tokenIn amount (must be > 0)`);
      }
      if (step.tokenOut?.amount && step.tokenOut.amount <= 0) {
        errors.push(`Step ${i + 1}: Invalid tokenOut amount (must be > 0)`);
      }
    }

    const strategyValidation = this.validateOverallStrategy(steps);
    const flowValidation = this.validateStrategyFlow(steps);

    errors.push(...strategyValidation.errors, ...flowValidation.errors);
    warnings.push(...strategyValidation.warnings, ...flowValidation.warnings);

    const isValid = errors.length === 0;

    this.logger.log('Strategy validation completed', {
      isValid,
      errorCount: errors.length,
      warningCount: warnings.length,
    });

    if (!isValid) {
      this.logger.warn('Strategy validation failed', { errors });
    }

    return {
      isValid,
      errors,
      warnings,
    };
  }

  private isValidOperationType(type: string): boolean {
    const validTypes = [
      'SWAP',
      'SUPPLY',
      'BORROW',
      'JOIN_STRATEGY',
      'ENABLE_E_MODE',
      'BRIDGE',
      'STAKE',
      'UNSTAKE',
      'CLAIM_REWARDS',
    ];
    return validTypes.includes(type);
  }

  private requiresTokenValidation(type: string): boolean {
    return ['SWAP', 'SUPPLY', 'BORROW', 'JOIN_STRATEGY'].includes(type);
  }

  private async validateTokenPair(
    step: StrategyStepResponseDto,
  ): Promise<{ isValid: boolean; error?: string }> {
    try {
      let operationType: OperationType;
      switch (step.type) {
        case 'SWAP':
          operationType = OperationType.SWAP;
          break;
        case 'SUPPLY':
          operationType = OperationType.SUPPLY;
          break;
        case 'BORROW':
          operationType = OperationType.BORROW;
          break;
        case 'JOIN_STRATEGY':
          operationType = OperationType.JOIN_STRATEGY;
          break;
        default:
          return { isValid: true };
      }

      if (
        (operationType === OperationType.SWAP ||
          operationType === OperationType.JOIN_STRATEGY) &&
        step.tokenIn &&
        step.tokenOut
      ) {
        const [tokenInEntity, tokenOutEntity] = await Promise.all([
          this.getTokenIdByAssetId(step.tokenIn.assetId),
          this.getTokenIdByAssetId(step.tokenOut.assetId),
        ]);

        const estimate = await this.defiPairsService.estimateDefiPair({
          operation_type: operationType,
          token_in_id: tokenInEntity,
          token_out_id: tokenOutEntity,
          amount_in: step.tokenIn.amount,
        });

        if (!estimate) {
          return {
            isValid: false,
            error: `Token pair ${step.tokenIn.symbol}/${step.tokenOut.symbol} not supported for ${step.type}`,
          };
        }
      }

      if (operationType === OperationType.SUPPLY && step.tokenIn) {
        const tokenInEntity = await this.getTokenIdByAssetId(
          step.tokenIn.assetId,
        );

        const estimate = await this.defiPairsService.estimateDefiPair({
          operation_type: operationType,
          token_in_id: tokenInEntity,
          amount_in: step.tokenIn.amount,
        });

        if (!estimate) {
          return {
            isValid: false,
            error: `Token ${step.tokenIn.symbol} not supported for SUPPLY`,
          };
        }
      }

      if (operationType === OperationType.BORROW && step.tokenOut) {
        return { isValid: true };
      }

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: `Failed to validate token pair: ${getErrorMessage(error)}`,
      };
    }
  }

  private async getTokenIdByAssetId(assetId: string): Promise<string> {
    try {
      const token = await this.defiTokenService.getDefiTokenByAssetId(assetId);
      return token.id;
    } catch (error) {
      throw new Error(
        `Failed to find token with assetId ${assetId}: ${getErrorMessage(error)}`,
      );
    }
  }

  private validateSequence(
    prevStep: StrategyStepResponseDto,
    currentStep: StrategyStepResponseDto,
  ): { isValid: boolean; warning?: string } {
    if (prevStep.tokenOut && currentStep.tokenIn) {
      if (prevStep.tokenOut.symbol !== currentStep.tokenIn.symbol) {
        return {
          isValid: false,
          warning: `Token mismatch: previous step outputs ${prevStep.tokenOut.symbol} but current step expects ${currentStep.tokenIn.symbol}`,
        };
      }

      const amountDiff = Math.abs(
        prevStep.tokenOut.amount - currentStep.tokenIn.amount,
      );
      if (amountDiff > prevStep.tokenOut.amount * 0.5) {
        return {
          isValid: false,
          warning: `Large amount discrepancy between steps (${prevStep.tokenOut.amount} vs ${currentStep.tokenIn.amount})`,
        };
      }
    }

    const sequenceValidation = this.validateStepSequenceRules(
      prevStep.type,
      currentStep.type,
    );
    if (!sequenceValidation.isValid) {
      return sequenceValidation;
    }

    return { isValid: true };
  }

  private validateStepSequenceRules(
    prevStepType: string,
    currentStepType: string,
  ): { isValid: boolean; warning?: string } {
    if (
      prevStepType === 'ENABLE_E_MODE' ||
      currentStepType === 'ENABLE_E_MODE'
    ) {
      return { isValid: true };
    }

    const allowedNextSteps: Record<string, string[]> = {
      SWAP: ['SUPPLY', 'SWAP', 'JOIN_STRATEGY'],
      JOIN_STRATEGY: ['SWAP', 'BORROW'],
      SUPPLY: ['BORROW'],
      BORROW: ['SWAP', 'JOIN_STRATEGY', 'SUPPLY'],
    };

    const allowedNext = allowedNextSteps[prevStepType];

    if (!allowedNext) {
      return { isValid: true };
    }

    if (!allowedNext.includes(currentStepType)) {
      return {
        isValid: false,
        warning: `Invalid sequence: ${currentStepType} cannot follow ${prevStepType}. Allowed next steps after ${prevStepType}: ${allowedNext.join(', ')}`,
      };
    }

    return { isValid: true };
  }

  private validateOverallStrategy(steps: StrategyStepResponseDto[]): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const hasBorrow = steps.some((s) => s.type === 'BORROW');
    const hasEMode = steps.some((s) => s.type === 'ENABLE_E_MODE');

    if (hasBorrow && !hasEMode) {
      warnings.push(
        'Strategy includes BORROW but no ENABLE_E_MODE - consider adding it for better rates',
      );
    }

    const loopCount = steps.filter((s) => s.type === 'BORROW').length;
    if (loopCount > 10) {
      warnings.push(
        `Strategy has ${loopCount} loops - this may be excessive and risky`,
      );
    }

    const firstBorrowIndex = steps.findIndex((s) => s.type === 'BORROW');
    const firstSupplyIndex = steps.findIndex(
      (s) => s.type === 'SUPPLY' || s.type === 'JOIN_STRATEGY',
    );

    if (firstBorrowIndex !== -1 && firstSupplyIndex === -1) {
      errors.push('Cannot BORROW without first supplying collateral');
    }

    if (firstBorrowIndex !== -1 && firstSupplyIndex > firstBorrowIndex) {
      errors.push('Must SUPPLY collateral before BORROW');
    }

    if (steps.length === 0) {
      errors.push('Strategy must have at least one step');
    }

    return { errors, warnings };
  }

  private validateStrategyFlow(steps: StrategyStepResponseDto[]): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const nonEModeSteps = steps.filter((step) => step.type !== 'ENABLE_E_MODE');
    if (nonEModeSteps.length === 0) {
      errors.push(
        'Strategy must contain at least one operational step besides ENABLE_E_MODE',
      );
      return { errors, warnings };
    }

    const stepTypes = nonEModeSteps.map((step) => step.type);

    const hasSupply =
      stepTypes.includes('SUPPLY') || stepTypes.includes('JOIN_STRATEGY');
    const hasBorrow = stepTypes.includes('BORROW');

    if (hasBorrow && !hasSupply) {
      errors.push(
        'Cannot borrow without first supplying collateral (SUPPLY or JOIN_STRATEGY)',
      );
    }

    const borrowCount = stepTypes.filter((type) => type === 'BORROW').length;
    const supplyCount = stepTypes.filter((type) => type === 'SUPPLY').length;
    const joinCount = stepTypes.filter(
      (type) => type === 'JOIN_STRATEGY',
    ).length;

    if (borrowCount > supplyCount + joinCount) {
      warnings.push(
        'More BORROW operations than collateral operations - strategy may be unbalanced',
      );
    }

    if (stepTypes.length > 20) {
      warnings.push(
        'Strategy is very complex with many steps - consider simplifying for better execution',
      );
    }

    for (let i = 1; i < nonEModeSteps.length; i++) {
      const prevStep = nonEModeSteps[i - 1];
      const currentStep = nonEModeSteps[i];

      const sequenceValidation = this.validateStepSequenceRules(
        prevStep.type,
        currentStep.type,
      );
      if (!sequenceValidation.isValid) {
        errors.push(`Flow validation: ${sequenceValidation.warning}`);
      }
    }

    return { errors, warnings };
  }

  getBusinessRules(): Record<string, string[]> {
    return {
      SWAP: ['SUPPLY', 'SWAP', 'JOIN_STRATEGY'],
      JOIN_STRATEGY: ['SWAP', 'BORROW'],
      SUPPLY: ['BORROW'],
      BORROW: ['SWAP', 'JOIN_STRATEGY', 'SUPPLY'],
    };
  }

  isValidSequence(fromStep: string, toStep: string): boolean {
    const rules = this.getBusinessRules();
    const allowedNext = rules[fromStep];

    if (!allowedNext) {
      return true;
    }

    return allowedNext.includes(toStep);
  }
}
