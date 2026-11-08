import type { DataExportStore } from '../../application/ports/data-export-store.js';
import { DataExportUnavailableError } from '../../domain/dataexport.errors.js';

/** Without a database the export routes answer 503 and the worker finds nothing to do. */
export class UnavailableDataExportStore implements DataExportStore {
  list = () => Promise.reject(new DataExportUnavailableError());
  get = () => Promise.reject(new DataExportUnavailableError());
  countSince = () => Promise.reject(new DataExportUnavailableError());
  hasActive = () => Promise.reject(new DataExportUnavailableError());
  create = () => Promise.reject(new DataExportUnavailableError());
  setLink = () => Promise.reject(new DataExportUnavailableError());
  consumeLink = () => Promise.reject(new DataExportUnavailableError());
  claim = () => Promise.resolve(null);
  finishReady = () => Promise.resolve();
  finishFailed = () => Promise.resolve();
  expireDue = () => Promise.resolve([]);
}
