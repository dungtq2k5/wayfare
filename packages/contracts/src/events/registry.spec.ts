import { describe, expect, it } from 'vitest';
import { compareStrings } from '../common/sorting';
import { z } from 'zod';
import { LocalizationTargetType, TranslationSource } from '../narration/enums';
import { NotificationType } from '../notifications/types';
import {
  defineEvent,
  eventSchema,
  EventDefinitionError,
  PUBLISHER_STREAM,
} from './event-definition';
import type { EventDefinition } from './event-definition';
import { EVENT_FIXTURES, FIXTURE_IDS } from '../testing/fixtures';
import type { EventFixture } from '../testing/fixtures';
import { EVENT_DEFINITIONS, EVENT_REGISTRY, SENSITIVE_SUBJECTS } from './registry';
import { streamsForSubject } from './streams';

const definitions: readonly EventDefinition[] = EVENT_DEFINITIONS;
function fixtureFor(subject: string): EventFixture {
  const fixture = EVENT_FIXTURES[subject];
  if (!fixture) throw new Error(`No fixture for ${subject}`);
  return fixture;
}

function definitionFor(subject: string): EventDefinition {
  const definition = EVENT_REGISTRY[subject];
  if (!definition) throw new Error(`No definition for ${subject}`);
  return definition;
}

describe('events registry', () => {
  it('declares every subject once', () => {
    const subjects = definitions.map((definition) => definition.subject);
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(Object.keys(EVENT_REGISTRY)).toHaveLength(subjects.length);
    expect(subjects).toHaveLength(25);
  });

  it.each(definitions.map((definition) => [definition.subject, definition] as const))(
    '%s sits in exactly one stream, its own',
    (subject, definition) => {
      expect(streamsForSubject(subject)).toEqual([definition.stream]);
    },
  );

  it.each(definitions.map((definition) => [definition.subject, definition] as const))(
    "%s agrees with its publisher's prefix",
    (subject, definition) => {
      if (definition.publisher === 'any') {
        expect(['audit.record', 'notification.create']).toContain(subject);
      } else {
        expect(subject.startsWith(`${definition.publisher}.`)).toBe(true);
        expect(definition.stream).toBe(PUBLISHER_STREAM[definition.publisher]);
      }
    },
  );

  it.each(definitions.map((definition) => [definition.subject, definition] as const))(
    '%s refuses an unknown field and a v4 eventId',
    (subject, definition) => {
      const { payload } = fixtureFor(subject);
      expect(definition.schema.safeParse(payload).success).toBe(true);
      expect(definition.schema.safeParse({ ...payload, extra: 1 }).success).toBe(false);
      const v4 = '01990000-0000-4000-8000-000000000001';
      expect(definition.schema.safeParse({ ...payload, eventId: v4 }).success).toBe(false);
    },
  );

  it('marks only billing.staff.invited sensitive — a second secret is a deliberate edit', () => {
    expect([...SENSITIVE_SUBJECTS]).toEqual(['billing.staff.invited']);
  });
});

describe('events fixtures', () => {
  it('cover every subject', () => {
    expect(Object.keys(EVENT_FIXTURES).toSorted(compareStrings)).toEqual(
      Object.keys(EVENT_REGISTRY).toSorted(compareStrings),
    );
  });

  it.each(definitions.map((definition) => [definition.subject, definition] as const))(
    '%s parses, round-trips through JSON unchanged, and derives its aggregate id',
    (subject, definition) => {
      const fixture = fixtureFor(subject);
      const parsed = definition.schema.parse(fixture.payload);
      const wire: unknown = JSON.parse(JSON.stringify(parsed));
      expect(definition.schema.parse(wire)).toEqual(parsed);
      expect(definition.aggregateId(parsed)).toBe(fixture.aggregateId);
    },
  );
});

describe('events refinements', () => {
  const ready = definitionFor('narration.localization.ready');
  const readyPayload = fixtureFor('narration.localization.ready').payload;

  it('narration.localization.ready refuses audio on a MENU_ITEM', () => {
    const { audio, ...base } = readyPayload;
    const menuItem = {
      ...base,
      targetType: LocalizationTargetType.MENU_ITEM,
      targetId: FIXTURE_IDS.menuItem,
      translationSource: TranslationSource.MACHINE,
      text: { name: 'Pho bo' },
    };
    expect(ready.schema.safeParse(menuItem).success).toBe(true);
    expect(ready.schema.safeParse({ ...menuItem, audio }).success).toBe(false);
  });

  it('narration.localization.ready refuses a HUMAN voucher offer', () => {
    const { audio: _audio, ...base } = readyPayload;
    const offer = {
      ...base,
      targetType: LocalizationTargetType.VOUCHER_OFFER,
      targetId: FIXTURE_IDS.offer,
      text: { title: 'Two coffees', description: 'Any size.' },
    };
    expect(
      ready.schema.safeParse({ ...offer, translationSource: TranslationSource.MACHINE }).success,
    ).toBe(true);
    expect(
      ready.schema.safeParse({ ...offer, translationSource: TranslationSource.HUMAN }).success,
    ).toBe(false);
  });

  it('narration.localization.ready refuses a HUMAN place without audio', () => {
    const { audio: _audio, ...withoutAudio } = readyPayload;
    expect(ready.schema.safeParse(withoutAudio).success).toBe(false);
    expect(
      ready.schema.safeParse({ ...withoutAudio, translationSource: TranslationSource.MACHINE })
        .success,
    ).toBe(true);
  });

  it('narration.localization.ready refuses text shaped for another target', () => {
    const result = ready.schema.safeParse({
      ...readyPayload,
      text: { title: 'A tour', description: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('notification.create refuses data that belongs to another type', () => {
    const create = definitionFor('notification.create');
    const payload = fixtureFor('notification.create').payload;
    const mismatched = {
      ...payload,
      notification: {
        type: NotificationType.ACCOUNT_RECOVERY_COMPLETED,
        data: { placeId: FIXTURE_IDS.place },
      },
    };
    expect(create.schema.safeParse(mismatched).success).toBe(false);
  });

  it('audit.record refuses a resource type that does not match its action', () => {
    const audit = definitionFor('audit.record');
    const payload = fixtureFor('audit.record').payload;
    expect(
      audit.schema.safeParse({
        ...payload,
        resource: { ...(payload.resource as object), type: 'PLACE' },
      }).success,
    ).toBe(false);
  });
});

describe('defineEvent', () => {
  const schema = eventSchema({ placeId: z.string() });
  const aggregateId = (payload: { eventId: string }) => payload.eventId;

  it.each([
    [
      'a subject outside its publisher',
      { subject: 'billing.place.changed', publisher: 'catalog', stream: 'CATALOG' },
    ],
    [
      'a two-token subject',
      { subject: 'catalog.changed', publisher: 'catalog', stream: 'CATALOG' },
    ],
    [
      "another publisher's stream",
      { subject: 'catalog.place.changed', publisher: 'catalog', stream: 'BILLING' },
    ],
    [
      'an every-service subject without its stream',
      { subject: 'audit.other', publisher: 'any', stream: 'AUDIT' },
    ],
  ] as const)('refuses %s', (_label, fields) => {
    expect(() => defineEvent({ ...fields, schema, aggregateId })).toThrow(EventDefinitionError);
  });

  it('refuses a schema that is not strict, or has no UUIDv7 eventId', () => {
    const base = {
      subject: 'catalog.place.changed',
      publisher: 'catalog',
      stream: 'CATALOG',
      aggregateId,
    } as const;
    expect(() =>
      defineEvent({ ...base, schema: z.object({ eventId: z.string() }).strict() }),
    ).toThrow(/zUuidV7/);
    expect(() => defineEvent({ ...base, schema: schema.loose() })).toThrow(/strict/);
    expect(() => defineEvent({ ...base, schema })).not.toThrow();
  });
});

describe('events: identity.session.revoked', () => {
  it('bounds its family list', () => {
    const definition = definitionFor('identity.session.revoked');
    const payload = fixtureFor('identity.session.revoked').payload;
    const many = Array.from({ length: 101 }, () => FIXTURE_IDS.family);
    expect(definition.schema.safeParse({ ...payload, familyIds: many }).success).toBe(false);
    expect(definition.schema.safeParse({ ...payload, familyIds: [] }).success).toBe(false);
    expect(definition.schema.safeParse({ ...payload, familyIds: null }).success).toBe(true);
  });
});
