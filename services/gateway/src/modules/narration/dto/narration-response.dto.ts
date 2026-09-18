import { zNarrationStatus, zOnDemandResponse } from '@wayfare/contracts';
import type { OnDemandResponse, OnDemandStatus } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const [ready, pending, unavailable] = zOnDemandResponse.options;

/** What every on-demand variant shares. A class cannot extend a union; the schema stays the union. */
const onDemandSchema: z.ZodType<{ status: OnDemandStatus }> = zOnDemandResponse;

/** Every on-demand answer, validated as the union; the status code says which (api-endpoints-plan §4.1). */
export class OnDemandResponseDto extends createZodDto(onDemandSchema) {}

/** `200`: audio ready, or a language narration cannot serve. */
export const onDemandAnsweredResponseSchema = z.discriminatedUnion('status', [ready, unavailable]);

const answeredSchema: z.ZodType<{ status: OnDemandStatus }> = onDemandAnsweredResponseSchema;

/** The `200` answers, as documented. */
export class OnDemandAnsweredResponseDto extends createZodDto(answeredSchema) {}

/** `202`: a job is working on it. */
export class OnDemandPendingResponseDto extends createZodDto(pending) {}

/** A Place's narration in one language. */
export class NarrationStatusResponseDto extends createZodDto(zNarrationStatus) {}

/** An on-demand answer, as a type. */
export type OnDemandAnswer = OnDemandResponse;
