import { expect, it } from 'vitest';
import * as lib from '../src';

it('exposes the public API', () => {
  expect(Object.keys(lib).sort()).toEqual([
    'CancelError',
    'any',
    'cancel',
    'every',
    'flow',
    'isCancelError',
    'runFlow',
    'when',
  ]);
});
