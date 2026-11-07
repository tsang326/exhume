import fc from 'fast-check';
import { numRuns } from './runs.ts';

fc.configureGlobal({ numRuns: numRuns(100) });
