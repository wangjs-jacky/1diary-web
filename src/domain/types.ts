export type EntityKind =
  | 'category'
  | 'tag'
  | 'entry'
  | 'draft'
  | 'entry_tag'
  | 'draft_tag'
  | 'attachment'
  | 'draft_attachment_ref';

export type SyncOperationKind = 'upsert' | 'soft_delete' | 'restore' | 'purge';

export interface AuditFields {
  version: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Category extends AuditFields {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Tag extends AuditFields {
  id: string;
  name: string;
}

export interface Entry extends AuditFields {
  id: string;
  categoryId: string | null;
  bodyMarkdown: string;
  journalDate: string;
  journalTime: string;
  timezoneId: string;
  publishedAt: string;
  attachmentCount?: number;
  optimistic?: boolean;
  syncError?: string;
}

export type DraftKind = 'new' | 'edit' | 'conflict';

export interface RelationshipLink {
  id: string;
  tagId?: string;
  attachmentId?: string;
}

export interface Draft extends AuditFields {
  id: string;
  kind: DraftKind;
  baseEntryId: string | null;
  publishedEntryId: string | null;
  categoryId: string | null;
  bodyMarkdown: string;
  journalDate: string;
  journalTime: string;
  timezoneId: string;
  baseVersion: string | null;
  conflictReason: string | null;
  lastAutosavedAt: string;
  tagLinks?: Array<{ id: string; tagId: string }>;
  attachmentLinks?: Array<{ id: string; attachmentId: string }>;
  syncError?: string;
}

export interface EntryTag extends AuditFields {
  id: string;
  entryId: string;
  tagId: string;
}

export interface DraftTag extends AuditFields {
  id: string;
  draftId: string;
  tagId: string;
}

export interface Attachment extends AuditFields {
  id: string;
  entryId: string | null;
  draftId: string | null;
  mediaType: 'image';
  mimeType: string;
  originalFilename: string | null;
  sha256: string | null;
  byteSize: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  remoteState: 'pending' | 'ready';
  url?: string | null;
}

export interface DraftAttachmentRef extends AuditFields {
  id: string;
  draftId: string;
  attachmentId: string;
  sortOrder: number;
}

export interface AttachmentBlob {
  id: string;
  draftId: string;
  blob: Blob;
  mimeType: string;
  originalFilename: string | null;
  byteSize: number;
  status: 'pending' | 'uploading' | 'ready' | 'failed';
  createdAt: string;
  error?: string;
}

export interface SyncOperation {
  operationId: string;
  entityType: EntityKind;
  entityId: string;
  operation: SyncOperationKind;
  baseVersion: string;
  payload: Record<string, unknown>;
}

export interface OutboxRecord extends SyncOperation {
  createdAt: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
}

export interface SyncChange {
  changeId: string;
  entityType: EntityKind;
  entityId: string;
  operation: SyncOperationKind;
  version: string;
  changedAt: string;
  payload: Record<string, unknown>;
}

export interface BootstrapResponse {
  baselineCursor: string;
  data: {
    categories: Category[];
    tags: Tag[];
    entries: Entry[];
    drafts: Draft[];
    entryTags: EntryTag[];
    draftTags: DraftTag[];
    attachments: Attachment[];
    draftAttachmentRefs: DraftAttachmentRef[];
  };
}

export interface PullResponse {
  changes: SyncChange[];
  nextCursor: string;
  hasMore: boolean;
}

export interface SyncResult {
  operationId: string;
  entityType: EntityKind;
  entityId: string;
  status: 'applied' | 'conflict' | 'rejected' | 'retry';
  version?: string;
  conflictDraftId?: string;
  code?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';
