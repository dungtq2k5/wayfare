import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  newId,
  parseEnum,
  CategoryAppliesTo,
} from '@wayfare/contracts';
import type { AdminCategory, CategoryCreateInput, CategoryUpdateInput } from '@wayfare/contracts';
import {
  isUniqueConstraintViolation,
  OutboxService,
  requireAccountContext,
  rpcError,
} from '@wayfare/nest-common';
import type { AccountContext, RequestContext } from '@wayfare/nest-common';
import { taxonomyAuditRecord } from '../places/domain/place-audit';
import { PrismaService } from '../prisma/prisma.service';
import type { CatalogTx } from '../sync/sync.service';

const CATEGORY_FIELDS = {
  id: true,
  code: true,
  appliesTo: true,
  icon: true,
  sortOrder: true,
  isActive: true,
} as const;

/**
 * The categories (rdm-spec C-2), administered after the system registry inserted them. The code
 * never changes; `appliesTo` and deactivation govern new choices only — Places that have a
 * category keep it. Every change is audited; an unchanged edit writes nothing.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Every category, active or not, with how many non-deleted Places use it. */
  async listCategories(): Promise<AdminCategory[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: CATEGORY_FIELDS,
      }),
      this.placeCounts(),
    ]);
    return rows.map((row) => this.view(row, counts.get(row.id) ?? 0));
  }

  /** A new category; a taken code is `400` at `/code`. */
  async createCategory(
    context: RequestContext,
    input: CategoryCreateInput,
  ): Promise<AdminCategory> {
    const actor = requireAccountContext(context);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.category.create({
          data: { id: newId(), ...input },
          select: CATEGORY_FIELDS,
        });
        await this.audit(tx, actor, AuditAction.CATEGORY_CREATED, row.id, {
          after: {
            code: input.code,
            appliesTo: input.appliesTo,
            icon: input.icon,
            sortOrder: input.sortOrder,
          },
        });
        return this.view(row, 0);
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw rpcError('VALIDATION_FAILED', { issues: [{ path: '/code', code: 'taken' }] });
      }
      throw error;
    }
  }

  /** Changes the fields given; the Places that have the category keep it whatever changes. */
  async updateCategory(
    context: RequestContext,
    categoryId: string,
    input: CategoryUpdateInput,
  ): Promise<AdminCategory> {
    const actor = requireAccountContext(context);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.category.findUnique({
        where: { id: categoryId },
        select: CATEGORY_FIELDS,
      });
      if (current === null) {
        throw rpcError('RESOURCE_NOT_FOUND', { resource: AuditResourceType.CATEGORY });
      }
      const changed = (Object.keys(input) as (keyof CategoryUpdateInput)[]).filter(
        (field) => input[field] !== undefined && input[field] !== current[field],
      );
      if (changed.length === 0) return current;
      const data = Object.fromEntries(changed.map((field) => [field, input[field]]));
      const updated = await tx.category.update({
        where: { id: categoryId },
        data,
        select: CATEGORY_FIELDS,
      });
      await this.audit(tx, actor, AuditAction.CATEGORY_UPDATED, categoryId, {
        before: Object.fromEntries(changed.map((field) => [field, current[field]])),
        after: data,
      });
      return updated;
    });
    const counts = await this.placeCounts(categoryId);
    return this.view(row, counts.get(row.id) ?? 0);
  }

  private async placeCounts(categoryId?: string): Promise<Map<string, number>> {
    const groups = await this.prisma.place.groupBy({
      by: ['categoryId'],
      where: { deletedAt: null, ...(categoryId === undefined ? {} : { categoryId }) },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.categoryId, group._count._all]));
  }

  private view(
    row: {
      id: string;
      code: string;
      appliesTo: string;
      icon: string;
      sortOrder: number;
      isActive: boolean;
    },
    placeCount: number,
  ): AdminCategory {
    return {
      ...row,
      appliesTo: parseEnum(CategoryAppliesTo, row.appliesTo),
      placeCount,
    };
  }

  private async audit(
    tx: CatalogTx,
    actor: AccountContext,
    action: AuditAction,
    categoryId: string,
    metadata: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AUDIT_RECORD,
      taxonomyAuditRecord({
        actor: { type: AuditActorType.USER, userId: actor.userId },
        action,
        resource: AuditResourceType.CATEGORY,
        resourceId: categoryId,
        metadata,
        origin: actor.origin,
        now: new Date(),
      }),
    );
  }
}
