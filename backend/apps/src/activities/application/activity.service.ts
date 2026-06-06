import { Injectable } from '@nestjs/common';
import { Activity } from '../domain/activity.entity';
import { ActivityRepository } from '../domain/activity.repository';

@Injectable()
export class ActivityService {
  constructor(private readonly activityRepo: ActivityRepository) {}

  async findWithPagination(
    strategyId?: string,
    userAddress?: string,
    page = 1,
    limit = 10,
  ): Promise<{
    data: Activity[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const offset = (page - 1) * limit;
    const { data, total } = await this.activityRepo.findPaginated({
      strategyId,
      userAddress,
      offset,
      limit,
    });
    const totalPages = Math.ceil(total / limit);

    if (totalPages > 0 && page > totalPages) {
      return {
        data: [],
        meta: {
          page,
          limit,
          total,
          totalPages,
        },
      };
    }
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}
