import Dexie, { type EntityTable } from 'dexie';
import type {
  Attachment,
  AttachmentBlob,
  Category,
  Draft,
  DraftAttachmentRef,
  DraftTag,
  Entry,
  EntryTag,
  OutboxRecord,
  Tag,
} from '../domain/types';

export interface MetaRecord {
  key: string;
  value: string;
}

class DiaryDatabase extends Dexie {
  categories!: EntityTable<Category, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  entries!: EntityTable<Entry, 'id'>;
  drafts!: EntityTable<Draft, 'id'>;
  entryTags!: EntityTable<EntryTag, 'id'>;
  draftTags!: EntityTable<DraftTag, 'id'>;
  attachments!: EntityTable<Attachment, 'id'>;
  draftAttachmentRefs!: EntityTable<DraftAttachmentRef, 'id'>;
  attachmentBlobs!: EntityTable<AttachmentBlob, 'id'>;
  outbox!: EntityTable<OutboxRecord, 'operationId'>;
  meta!: EntityTable<MetaRecord, 'key'>;

  constructor() {
    super('one-diary');
    this.version(1).stores({
      categories: 'id, sortOrder, deletedAt',
      tags: 'id, name, deletedAt',
      entries: 'id, [journalDate+journalTime], categoryId, updatedAt, deletedAt',
      drafts: 'id, kind, baseEntryId, lastAutosavedAt, deletedAt',
      entryTags: 'id, entryId, tagId, deletedAt',
      draftTags: 'id, draftId, tagId, deletedAt',
      attachments: 'id, entryId, draftId, remoteState, deletedAt',
      draftAttachmentRefs: 'id, draftId, attachmentId, sortOrder, deletedAt',
      attachmentBlobs: 'id, draftId, status, createdAt',
      outbox: 'operationId, entityType, entityId, createdAt, nextAttemptAt',
      meta: 'key',
    });
  }
}

export const db = new DiaryDatabase();

export async function clearDiaryData() {
  await db.transaction(
    'rw',
    [
      db.categories,
      db.tags,
      db.entries,
      db.drafts,
      db.entryTags,
      db.draftTags,
      db.attachments,
      db.draftAttachmentRefs,
      db.attachmentBlobs,
      db.outbox,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.categories.clear(),
        db.tags.clear(),
        db.entries.clear(),
        db.drafts.clear(),
        db.entryTags.clear(),
        db.draftTags.clear(),
        db.attachments.clear(),
        db.draftAttachmentRefs.clear(),
        db.attachmentBlobs.clear(),
        db.outbox.clear(),
        db.meta.clear(),
      ]);
    },
  );
}
