import { writeFile } from 'node:fs/promises';
import { collectionSchema, experimentSchema, sampleSchema } from '../src/shared/contracts.js';
import { scoringItemSchema, scoringLabelSchema, scoringSetSchema } from '../src/shared/scoring.js';
for (const [name, schema] of [['collection', collectionSchema], ['experiment', experimentSchema], ['sample', sampleSchema], ['scoring-set', scoringSetSchema], ['scoring-item', scoringItemSchema], ['scoring-label', scoringLabelSchema]] as const)
    await writeFile(`schemas/${name}.schema.json`, JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema }, null, 2) + '\n');
