export const RESUMABLE_UPLOAD_MIN_BYTES = 8 * 1024 * 1024;
export const RESUMABLE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export interface TransferCheckpoint {
  offset: number;
  fileId: string | null;
  chunkSize: number;
}
