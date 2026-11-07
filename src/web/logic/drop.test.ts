import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { classifyDrop, DROP_REJECT_MESSAGE, type DropInfo } from './drop';

describe('classifyDrop', () => {
  it('rejects a drop with no file', () => {
    expect(classifyDrop({ itemKinds: ['string'], fileCount: 0, firstIsDirectory: false })).toEqual({
      action: 'reject',
      message: DROP_REJECT_MESSAGE,
    });
  });

  it('rejects a directory', () => {
    expect(classifyDrop({ itemKinds: ['file'], fileCount: 1, firstIsDirectory: true }).action).toBe('reject');
  });

  it('uses the only file without ignoring others', () => {
    expect(classifyDrop({ itemKinds: ['file'], fileCount: 1, firstIsDirectory: false })).toEqual({
      action: 'use-first',
      ignoredOthers: false,
    });
  });

  it('uses the first of several files and flags the rest', () => {
    expect(classifyDrop({ itemKinds: ['file', 'file'], fileCount: 2, firstIsDirectory: false })).toEqual({
      action: 'use-first',
      ignoredOthers: true,
    });
  });

  // Feature: graveyard-ui, Property 15: Drops are classified by what they carry
  // **Validates: Requirements 4.5, 4.6, 4.9**
  it('Property 15: classifies drops by what they carry', () => {
    const infoArb: fc.Arbitrary<DropInfo> = fc.record({
      itemKinds: fc.array(fc.constantFrom('file', 'string', 'other'), { maxLength: 6 }),
      fileCount: fc.integer({ min: 0, max: 50 }),
      firstIsDirectory: fc.boolean(),
    });
    fc.assert(
      fc.property(infoArb, (info) => {
        const d = classifyDrop(info);
        if (info.fileCount === 0 || info.firstIsDirectory) {
          return d.action === 'reject' && d.message === DROP_REJECT_MESSAGE && d.message.length > 0;
        }
        return d.action === 'use-first' && d.ignoredOthers === info.fileCount > 1;
      }),
      { numRuns: numRuns(200) },
    );
  });
});
