import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allScenarios } from '../scenarios.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const list = allScenarios(path.resolve(here, '../../../../carriers'));
writeFileSync(process.argv[2] ?? 'scenarios.json', JSON.stringify(list));
console.warn(`wrote ${list.length} scenarios`);
