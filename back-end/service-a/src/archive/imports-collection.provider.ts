import { type Collection, type MongoClient } from 'mongodb';

import { MONGO_CLIENT } from '../infra/infra-clients.tokens.js';

import { type IImportRunDocument } from './import-run.types.js';

export const IMPORTS_COLLECTION = 'IMPORTS_COLLECTION';

const IMPORTS_COLLECTION_NAME = 'imports';

export function createImportsCollection(client: MongoClient): Collection<IImportRunDocument> {
  return client.db().collection<IImportRunDocument>(IMPORTS_COLLECTION_NAME);
}

export const importsCollectionProvider = {
  provide: IMPORTS_COLLECTION,
  inject: [MONGO_CLIENT],
  useFactory: createImportsCollection,
};
