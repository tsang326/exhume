import { describe, expect, it } from 'vitest';
import { TEXT_CHUNK_BYTES } from './limits';
import { makeAsciiSink } from './textsink';

describe('makeAsciiSink', () => {
  it('returns an empty string when nothing was written', () => {
    const sink = makeAsciiSink();
    expect(sink.length).toBe(0);
    expect(sink.finish()).toBe('');
  });

  it('keeps text exact across multiple chunks', () => {
    const sink = makeAsciiSink();
    const n = TEXT_CHUNK_BYTES * 2 + 17;
    let expected = '';
    for (let i = 0; i < n; i++) {
      const code = 0x20 + (i % 0x5f);
      sink.push(code);
      expected += String.fromCharCode(code);
    }
    expect(sink.finish()).toBe(expected);
  });

  it('counts bytes from push and pushString', () => {
    const sink = makeAsciiSink();
    sink.push(0x41);
    sink.pushString('bc\n');
    expect(sink.length).toBe(4);
    expect(sink.finish()).toBe('Abc\n');
  });

  it('handles exactly one full chunk', () => {
    const sink = makeAsciiSink();
    sink.pushString('x'.repeat(TEXT_CHUNK_BYTES));
    expect(sink.length).toBe(TEXT_CHUNK_BYTES);
    expect(sink.finish()).toBe('x'.repeat(TEXT_CHUNK_BYTES));
  });
});
