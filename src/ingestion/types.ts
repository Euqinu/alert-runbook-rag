/**
 * What a chunker produces. Document-level fields (source, url, license, doc_hash)
 * are added later by the loader, so chunkers stay pure: text in, drafts out.
 */
export interface ChunkDraft {
  text: string;
  title: string;
  alertName: string | null;
  chunkIndex: number;
}
