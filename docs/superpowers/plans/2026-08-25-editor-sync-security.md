# 一本日记编辑器、同步与安全修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用稳定的组件化编辑体验替换原生实现，恢复附件与日记同步，并安全部署到现有生产环境。

**Architecture:** 前端以 Tiptap 维护编辑状态并序列化为兼容现有 API 的 Markdown，React Aria Components 提供日期、时间和分类交互。同步层将附件上传结果建模为可恢复的部分失败，不再让单个附件阻塞全量 outbox；基础设施层补齐 OSS CORS，并以独立 SQL 迁移关闭 Supabase Data API 对业务表的直接访问。

**Tech Stack:** React 19、TypeScript、Tiptap、React Aria Components、Dexie、Vitest、Fastify、PostgreSQL/Supabase、Alibaba Cloud OSS、Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-25-editor-sync-security-design.md`

## Global Constraints

- 业务正文继续持久化为 Markdown，不修改后端日记字段或同步协议。
- 历史 `![说明](attachment://ID)` 图片必须继续可读，新增宽度使用 `{width=N%}`。
- 空白日记不保存；输入 700ms 后自动保存；未明确发布的内容保留为草稿。
- 单个附件失败不得阻塞不相关 outbox 操作，也不得清空本地正文或附件 Blob。
- OSS CORS 只允许 `http://121.43.32.242:3080`，不使用通配来源。
- 客户端只直连 Supabase Auth，所有业务表数据继续经过后端 API。
- 不删除现有 IndexedDB、Supabase 业务数据或 OSS 对象。

---

### Task 1: Markdown 附件宽度契约

**Files:**
- Modify: `src/lib/markdown.ts`
- Modify: `src/lib/markdown.test.ts`

**Interfaces:**
- Produces: `parseAttachmentMarkdown(markdown: string): AttachmentMarkdownToken[]`
- Produces: `serializeAttachmentMarkdown(input: { id: string; alt?: string; widthPercent?: number }): string`
- Produces: `markdownToHtml(markdown, attachmentUrls)` 对 `{width=N%}` 输出受限宽度样式

- [ ] **Step 1: 写失败测试**

```ts
expect(parseAttachmentMarkdown('![图](attachment://abc){width=50%}')).toEqual([
  { id: 'abc', alt: '图', widthPercent: 50 },
]);
expect(serializeAttachmentMarkdown({ id: 'abc', alt: '图', widthPercent: 75 }))
  .toBe('![图](attachment://abc){width=75%}');
expect(markdownToHtml('![](attachment://abc)', new Map([['abc', '/a.jpg']])))
  .toContain('width:100%');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/markdown.test.ts`
Expected: FAIL，提示新导出不存在或宽度未序列化。

- [ ] **Step 3: 实现最小解析与序列化**

```ts
export type AttachmentMarkdownToken = { id: string; alt: string; widthPercent: number };
export function clampImageWidth(value?: number) {
  return Math.min(100, Math.max(20, Number.isFinite(value) ? Math.round(value!) : 100));
}
type SerializeAttachmentInput = { id: string; alt?: string; widthPercent?: number };
export function serializeAttachmentMarkdown({ id, alt = '', widthPercent = 100 }: SerializeAttachmentInput) {
  return `![${escapeAlt(alt)}](attachment://${id}){width=${clampImageWidth(widthPercent)}%}`;
}
```

解析器接受无后缀历史格式并返回 100；HTML 渲染只插入数值化、夹紧后的百分比，禁止把原始属性文本拼入 style。

- [ ] **Step 4: 运行测试和类型检查**

Run: `pnpm test -- src/lib/markdown.test.ts && pnpm typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/markdown.ts src/lib/markdown.test.ts
git commit -m "feat(editor): support persisted image widths"
```

### Task 2: Tiptap 编辑器与图片节点

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/editor/AttachmentImage.tsx`
- Create: `src/editor/DiaryEditor.tsx`
- Create: `src/editor/DiaryEditor.test.tsx`
- Modify: `src/editor/EditorPage.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `serializeAttachmentMarkdown`、`parseAttachmentMarkdown`
- Produces: `<DiaryEditor value attachmentUrls onChange onPasteImage />`
- Produces: `DiaryEditorHandle.insertAttachment({ id, src, alt, widthPercent })`

- [ ] **Step 1: 安装固定版本依赖**

Run: `pnpm add --save-exact @tiptap/react @tiptap/starter-kit @tiptap/extension-image @tiptap/extension-placeholder @tiptap/markdown react-aria-components @internationalized/date lucide-react`
Expected: `package.json` 与 lockfile 更新，peer dependency 无错误。

- [ ] **Step 2: 写编辑器行为失败测试**

```tsx
render(<DiaryEditor value="普通正文" attachmentUrls={new Map()} onChange={onChange} onPasteImage={onPasteImage} />);
await user.click(screen.getByRole('button', { name: '加粗' }));
expect(screen.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'true');
await user.click(screen.getByRole('button', { name: '加粗' }));
expect(screen.getByRole('button', { name: '加粗' })).toHaveAttribute('aria-pressed', 'false');
await user.click(screen.getByRole('button', { name: '清除格式' }));
expect(onChange).toHaveBeenLastCalledWith(expect.not.stringContaining('**'));
```

另写图片测试：选择图片后点击“50%”，`onChange` 最终包含 `{width=50%}`；剪贴板包含图片时调用 `onPasteImage(file)`。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test -- src/editor/DiaryEditor.test.tsx`
Expected: FAIL，组件尚不存在。

- [ ] **Step 4: 实现编辑器和附件节点**

`DiaryEditor` 使用 Tiptap StarterKit 和 Image 扩展，工具栏命令分别调用：

```ts
editor.chain().focus().setParagraph().run();
editor.chain().focus().toggleHeading({ level: 2 }).run();
editor.chain().focus().toggleBold().run();
editor.chain().focus().toggleItalic().run();
editor.chain().focus().toggleBulletList().run();
editor.chain().focus().toggleOrderedList().run();
editor.chain().focus().toggleBlockquote().run();
editor.chain().focus().toggleCode().run();
editor.chain().focus().unsetAllMarks().clearNodes().run();
```

附件 node view 读取 `attachmentId`、`src`、`alt`、`widthPercent`，用 ProseMirror `updateAttributes` 保存拖拽结果和快捷宽度；拖拽只改变宽度并保持图片自然宽高比。

- [ ] **Step 5: 接入 EditorPage**

移除 `contentEditable`、`execCommand`、Selection/Range 和隐藏格式菜单。`persistDraft()` 从 `DiaryEditor` 最新 Markdown 取值，并从解析出的附件 ID 建立 `attachmentLinks`；`insertImage()` 保存 Blob 后调用 handle 插入附件节点。继续使用 700ms debounce、空白校验、字数统计和现有发布流程。

- [ ] **Step 6: 运行编辑器测试和类型检查**

Run: `pnpm test -- src/editor/DiaryEditor.test.tsx src/lib/markdown.test.ts && pnpm typecheck`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add package.json pnpm-lock.yaml src/editor src/styles.css
git commit -m "feat(editor): replace native editing with Tiptap"
```

### Task 3: React Aria 日期、时间、分类与标签控件

**Files:**
- Create: `src/editor/DiaryFields.tsx`
- Create: `src/editor/DiaryFields.test.tsx`
- Modify: `src/editor/EditorPage.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `<DiaryFields journalDate journalTime categoryId selectedTags categories tags onDateChange onTimeChange onCategoryChange onTagsChange />`

- [ ] **Step 1: 写可访问性交互失败测试**

```tsx
render(<DiaryFields {...fixture} />);
await user.click(screen.getByRole('button', { name: '选择日期' }));
expect(screen.getByRole('dialog')).toBeVisible();
await user.click(screen.getByRole('option', { name: '工作' }));
expect(onCategoryChange).toHaveBeenCalledWith('category-work');
```

测试日期弹层、时间字段、分类选择以及多标签切换均可通过角色和键盘访问。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/editor/DiaryFields.test.tsx`
Expected: FAIL，组件尚不存在。

- [ ] **Step 3: 实现组件并替换原生控件**

使用 React Aria `DatePicker`/`Calendar`、`TimeField`、`Select`、`TagGroup`。通过 `parseDate` 和 `parseTime` 在 ISO 字符串与 React Aria value 间转换；空分类值映射为 `null`/空字符串，不创建虚假分类。

- [ ] **Step 4: 运行测试、类型检查和构建**

Run: `pnpm test -- src/editor/DiaryFields.test.tsx && pnpm typecheck && pnpm build`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/editor/DiaryFields.tsx src/editor/DiaryFields.test.tsx src/editor/EditorPage.tsx src/styles.css
git commit -m "feat(editor): add accessible diary field controls"
```

### Task 4: 同步队列部分失败与可重试状态

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/data/sync.ts`
- Modify: `src/data/sync.test.ts`
- Modify: `src/sync/SyncContext.tsx`
- Modify: `src/feed/TimelinePage.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `uploadPendingAttachments(): Promise<AttachmentUploadSummary>`
- Produces: `partitionPushableRecords(records, failedDraftIds): { pushable; deferred }`
- Produces: `SyncStatus = 'idle' | 'syncing' | 'offline' | 'partial' | 'error'`

- [ ] **Step 1: 写同步分流失败测试**

```ts
const result = partitionPushableRecords(
  [failedDraftUpsert, unrelatedEntryDelete, categoryUpsert],
  new Set(['draft-with-failed-image']),
);
expect(result.deferred).toEqual([failedDraftUpsert]);
expect(result.pushable).toEqual([unrelatedEntryDelete, categoryUpsert]);
```

再用 mock API 测试附件上传失败时函数不抛出、Blob 状态变成 `failed`、不相关操作仍被 `/sync/push` 发送；下一轮上传成功后延期操作被发送。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/data/sync.test.ts`
Expected: FAIL，当前 `uploadPendingAttachments()` 会抛错并终止。

- [ ] **Step 3: 实现上传摘要与操作分流**

```ts
type AttachmentUploadSummary = {
  failedAttachmentIds: Set<string>;
  failedDraftIds: Set<string>;
  errors: string[];
};
```

逐个附件捕获失败并继续；`pushOutbox()` 只为 `pushable` 增加 attempts/backoff，延期记录保持原状。草稿 upsert 通过 `entityId`，发布 entry 通过 payload 中的 draft/attachment link 识别依赖。完成 pull 后，若存在失败附件，将状态设为 `partial` 并显示“部分内容待同步：图片上传失败，点击重试”。

- [ ] **Step 4: 更新同步徽标**

`SyncBadge` 显示 `detail`，`partial` 使用非阻断警示色并保留点击重试；离线和整体 API 失败维持原语义。

- [ ] **Step 5: 运行同步测试和全量前端检查**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/domain/types.ts src/data/sync.ts src/data/sync.test.ts src/sync/SyncContext.tsx src/feed/TimelinePage.tsx src/styles.css
git commit -m "fix(sync): isolate attachment upload failures"
```

### Task 5: Supabase Data API 收口迁移

**Files:**
- Modify: `../1diary-backend/src/db/migrations/0011_revoke_data_api_access.sql`
- Create: `../1diary-backend/src/db/migrations/0012_enable_business_table_rls.sql`
- Modify: `../1diary-backend/test/contract/migration-metadata.test.ts`

**Interfaces:**
- Consumes: 现有 `0011_revoke_data_api_access.sql` 撤销公开角色权限，但必须先补齐 Drizzle statement breakpoint
- Produces: 16 张 `public` 业务表启用 RLS，后端 owner/server role 保持可访问

- [ ] **Step 1: 写迁移契约失败测试**

```ts
const migration = await readFile(new URL('../../src/db/migrations/0012_enable_business_table_rls.sql', import.meta.url), 'utf8');
for (const table of businessTables) {
  expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
}
expect(migration).not.toMatch(/CREATE POLICY/i);
const revokeMigration = await readFile(new URL('../../src/db/migrations/0011_revoke_data_api_access.sql', import.meta.url), 'utf8');
expect(revokeMigration.match(/--> statement-breakpoint/g)).toHaveLength(3);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- test/contract/migration-metadata.test.ts`
Expected: FAIL，0012 尚不存在，且现有 0011 的三条顶层 REVOKE 没有逐条分隔。

- [ ] **Step 3: 修复 0011 并创建只启用 RLS 的迁移**

在 0011 的三条顶层 `REVOKE` 后分别加入 `--> statement-breakpoint`，使 PGlite 与生产 Drizzle migrator 都按单语句执行；同时更新 delta probe 对 0010/0011/0012 文件名的预期。

```sql
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.server_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_attachment_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_trash_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_retention_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_prune_checkpoints ENABLE ROW LEVEL SECURITY;
```

不创建客户端 policy，不撤销后端 owner 权限，不修改业务数据。

- [ ] **Step 4: 运行后端全量检查**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/db/migrations/0012_enable_business_table_rls.sql test/contract/migration-metadata.test.ts
git commit -m "fix(db): deny direct Data API table access"
```

### Task 6: OSS CORS、生产发布和端到端验收

**Files:**
- No source files expected; use existing Docker and deployment configuration in both repositories.

**Interfaces:**
- Consumes: 前端/后端通过全部静态检查的提交
- Produces: `http://121.43.32.242:3080` 上可用的新版本和完整同步链路

- [ ] **Step 1: 记录并设置 OSS CORS**

先读取当前配置并保存输出用于回滚，然后设置单条规则：

```json
{
  "AllowedOrigin": ["http://121.43.32.242:3080"],
  "AllowedMethod": ["POST", "GET", "HEAD"],
  "AllowedHeader": ["*"],
  "ExposeHeader": ["ETag"],
  "MaxAgeSeconds": 3600
}
```

再次读取 bucket CORS，确认不存在 `*` 来源。

- [ ] **Step 2: 确认后端数据库角色并执行迁移**

在 ECS 容器内只输出 `current_user` 和是否为表 owner，不输出数据库 URL。构建新后端镜像，运行一次 migrate 工具；健康检查失败则不替换 API 容器。

- [ ] **Step 3: 推送代码并部署后端**

Run locally: `git push origin main`

在 `/opt/1diary-backend` 拉取确定提交，执行：

```bash
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml run --rm migrate
docker compose --env-file .env.production -f compose.production.yml up -d api
docker compose --env-file .env.production -f compose.production.yml ps
```

Expected: API healthy，`/ready` 返回 200。

- [ ] **Step 4: 推送并部署前端**

Run locally: `git push origin main`

使用仓库现有 Docker 构建/发布方式更新 `one-diary-web`，保留旧镜像标签用于回滚。Expected: `http://121.43.32.242:3080` 返回 200 且静态资源无 404。

- [ ] **Step 5: 浏览器端到端回归**

使用现有固定账号登录，验证：格式按钮可添加/取消；“正文”和“清除格式”有效；日期/时间/分类可操作；粘贴图片后可拖拽和设为 50%；自动保存后同步徽标恢复“已同步”；刷新页面后文本、格式和图片宽度保持；生产日志出现 `attachments/complete` 与 `sync/push`。

- [ ] **Step 6: 验证数据库与服务顾问**

运行 Supabase security advisor，确认业务表不再报告 RLS disabled/公开访问；通过 API 创建并读取一篇临时纯文本日记后软删除，确认后端 owner 访问未受影响。

- [ ] **Step 7: 最终提交状态与回滚点**

记录前端提交、后端提交、容器状态、CORS 读取结果和健康检查。工作树必须干净；不得把 `.env`、账号密码、AccessKey 或数据库 URL 加入 Git。
