import { describe, it, expect } from 'vitest';
import { serializeDeep, deserializeDeep } from './backupService';

describe('backupService serialization', () => {
  it('serializes Timestamp and Date objects to { __ts: iso } recursively', () => {
    const fakeTimestamp = {
      seconds: 1776268800,
      nanoseconds: 0,
      toDate: () => new Date('2026-04-15T12:00:00.000Z')
    };

    const input = {
      name: 'Notebook Dell',
      createdAt: fakeTimestamp,
      nested: {
        updatedAt: new Date('2026-04-16T15:30:00.000Z'),
        tags: ['ti', 'hardware']
      },
      peripherals: [
        { type: 'Mouse', addedAt: fakeTimestamp }
      ]
    };

    const serialized = serializeDeep(input);

    expect(serialized.name).toBe('Notebook Dell');
    expect(serialized.createdAt).toEqual({ __ts: '2026-04-15T12:00:00.000Z' });
    expect(serialized.nested.updatedAt).toEqual({ __ts: '2026-04-16T15:30:00.000Z' });
    expect(serialized.nested.tags).toEqual(['ti', 'hardware']);
    expect(serialized.peripherals[0].addedAt).toEqual({ __ts: '2026-04-15T12:00:00.000Z' });
  });

  it('deserializes { __ts: iso } into Date instances recursively', () => {
    const serialized = {
      name: 'Notebook Dell',
      createdAt: { __ts: '2026-04-15T12:00:00.000Z' },
      nested: {
        updatedAt: { __ts: '2026-04-16T15:30:00.000Z' },
        normalString: '2026-04-15T12:00:00.000Z' // not a legacy date key, should stay string
      },
      peripherals: [
        { type: 'Mouse', addedAt: { __ts: '2026-04-15T12:00:00.000Z' } }
      ]
    };

    const restored = deserializeDeep(serialized);

    expect(restored.name).toBe('Notebook Dell');
    expect(restored.createdAt instanceof Date).toBe(true);
    expect(restored.createdAt.toISOString()).toBe('2026-04-15T12:00:00.000Z');
    expect(restored.nested.updatedAt instanceof Date).toBe(true);
    expect(typeof restored.nested.normalString).toBe('string');
    expect(restored.peripherals[0].addedAt instanceof Date).toBe(true);
  });

  it('deserializes legacy ISO date strings for known date fields', () => {
    const legacy = {
      internalId: 'TAG-001',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-02T10:00:00.000Z',
      description: '2026-01-01T10:00:00.000Z' // description is not a date field
    };

    const restored = deserializeDeep(legacy);

    expect(restored.createdAt instanceof Date).toBe(true);
    expect(restored.updatedAt instanceof Date).toBe(true);
    expect(typeof restored.description).toBe('string');
  });
});
