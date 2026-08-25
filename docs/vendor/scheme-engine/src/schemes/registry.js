import * as reg30A from './reg30A.js';
import * as reg33_5 from './reg33_5.js';
import * as reg33_7 from './reg33_7.js';
import * as reg33_7A from './reg33_7A.js';
import * as reg33_7B from './reg33_7B.js';

// The single place to register a new scheme evaluator — nothing downstream should import
// an individual scheme module directly.
export const SCHEMES = {
  [reg30A.meta.id]: reg30A,
  [reg33_5.meta.id]: reg33_5,
  [reg33_7.meta.id]: reg33_7,
  [reg33_7A.meta.id]: reg33_7A,
  [reg33_7B.meta.id]: reg33_7B,
};
