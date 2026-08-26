import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.ONE_DIARY_E2E_BASE_URL ?? 'http://121.43.32.242:3080';
const recordEvidence = process.env.ONE_DIARY_E2E_RECORD === '1';
const artifactDir = path.resolve(
  process.env.ONE_DIARY_E2E_ARTIFACT_DIR ?? 'artifacts/web-e2e/production-sync',
);

type PushObservation = {
  status: number;
  entityTypes: string[];
  resultStatuses: string[];
  error?: string;
};

function credentials() {
  const email = process.env.ONE_DIARY_E2E_EMAIL;
  const password = process.env.ONE_DIARY_E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('ONE_DIARY_E2E_EMAIL and ONE_DIARY_E2E_PASSWORD are required');
  }
  return { email, password };
}

async function authenticatedStorage(browser: Browser) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const { email, password } = credentials();
  await page.goto('/');
  await expect(page.getByText('需要完成连接配置')).toHaveCount(0);
  await page.getByLabel('账号').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入日记' }).click();
  await expect(page.getByRole('link', { name: '一本日记' })).toBeVisible();
  const storageState = await context.storageState();
  await context.close();
  return storageState;
}

async function createCaseContext(browser: Browser, storageState: Awaited<ReturnType<typeof authenticatedStorage>>) {
  await mkdir(artifactDir, { recursive: true });
  return browser.newContext({
    baseURL,
    storageState,
    viewport: { width: 1440, height: 900 },
    ...(recordEvidence
      ? { recordVideo: { dir: path.join(artifactDir, 'raw-video'), size: { width: 1440, height: 900 } } }
      : {}),
  });
}

function observePushes(page: Page, observations: PushObservation[]) {
  page.on('response', async (response) => {
    if (!response.url().includes('/sync/push')) return;
    try {
      const requestBody = response.request().postDataJSON() as {
        operations?: Array<{ entityType?: string }>;
      };
      const responseBody = await response.json() as {
        results?: Array<{ status?: string }>;
      };
      observations.push({
        status: response.status(),
        entityTypes: (requestBody.operations ?? []).map((item) => item.entityType ?? 'unknown'),
        resultStatuses: (responseBody.results ?? []).map((item) => item.status ?? 'unknown'),
      });
    } catch (error) {
      observations.push({
        status: response.status(),
        entityTypes: [],
        resultStatuses: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function waitForIdle(page: Page) {
  await expect(page.locator('.sync-badge')).toContainText('已同步', { timeout: 30_000 });
  await expect(page.locator('.sync-badge')).not.toContainText(/同步失败|部分待同步/);
}

async function showEvidenceNote(page: Page, text: string) {
  await page.evaluate((message) => {
    document.querySelector('[data-e2e-note]')?.remove();
    const note = document.createElement('div');
    note.dataset.e2eNote = 'true';
    note.textContent = message;
    Object.assign(note.style, {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 18px',
      borderRadius: '999px',
      color: '#fff',
      background: 'rgba(40, 54, 51, 0.9)',
      font: '15px system-ui, sans-serif',
      boxShadow: '0 8px 24px rgba(0,0,0,.18)',
    });
    document.body.append(note);
  }, text);
  await page.waitForTimeout(900);
}

async function clearIndexedDbAndReload(context: BrowserContext, page: Page) {
  if (recordEvidence) await showEvidenceNote(page, '清空本地日记缓存，验证服务端重新同步');
  const session = await context.newCDPSession(page);
  await page.goto('about:blank');
  await session.send('Storage.clearDataForOrigin', {
    origin: new URL(baseURL).origin,
    storageTypes: 'indexeddb',
  });
  await page.goto(baseURL);
}

async function cleanupEntry(browser: Browser, storageState: Awaited<ReturnType<typeof authenticatedStorage>>, marker: string) {
  const context = await browser.newContext({ baseURL, storageState, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '一本日记' })).toBeVisible();
    await waitForIdle(page);
    const card = page.locator('.diary-card').filter({ hasText: marker });
    if (await card.count()) {
      await card.getByRole('button', { name: '删除' }).click();
      await expect(card).toHaveCount(0);
      await page.locator('.sync-badge').click();
      const retry = page.getByRole('button', { name: '立即重试' });
      if (await retry.count()) await retry.click();
      await waitForIdle(page);
    }
  } finally {
    await context.close();
  }
}

async function seedBackedOffDelete(page: Page, marker: string) {
  await page.evaluate(async (entryMarker) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('one-diary');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const entry = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const transaction = database.transaction('entries', 'readonly');
        const request = transaction.objectStore('entries').getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const match = (request.result as Array<Record<string, unknown>>)
            .find((item) => String(item.bodyMarkdown ?? '').includes(entryMarker));
          if (match) resolve(match);
          else reject(new Error(`entry not found for ${entryMarker}`));
        };
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('outbox', 'readwrite');
        const now = new Date().toISOString();
        const randomTail = Math.floor(Math.random() * 0xffffffffffff)
          .toString(16)
          .padStart(12, '0');
        const operationId = `018f6b6a-7e02-7abc-8def-${randomTail}`;
        const request = transaction.objectStore('outbox').put({
            operationId,
            entityType: 'entry',
            entityId: entry.id,
            operation: 'soft_delete',
            baseVersion: entry.version,
            payload: {},
            createdAt: now,
            attempts: 4,
            nextAttemptAt: '2099-01-01T00:00:00.000Z',
            lastError: 'TEMPORARY_FAILURE',
        });
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, marker);
}

test('[SYNC-01] 完成日记后一次自动同步，并在清空本地缓存后从服务端恢复', async ({ browser }) => {
  const storageState = await authenticatedStorage(browser);
  const marker = `E2E-SYNC-${Date.now()}`;
  const observations: PushObservation[] = [];
  const consoleErrors: string[] = [];
  const context = await createCaseContext(browser, storageState);
  const page = await context.newPage();
  const video = page.video();
  observePushes(page, observations);
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  let videoPath: string | null = null;
  try {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '一本日记' })).toBeVisible();
    await page.getByRole('button', { name: '写新日记' }).click();
    const editor = page.getByRole('textbox', { name: '日记正文' });
    await expect(editor).toBeVisible();
    await editor.fill(`${marker}\n这是一条生产同步自动化验收日记。`);
    await expect(page.getByText('已保存到本地，等待同步')).toBeVisible();
    await page.getByRole('button', { name: '完成' }).click();

    const card = page.locator('.diary-card').filter({ hasText: marker });
    await expect(card).toBeVisible();
    await waitForIdle(page);
    await expect(card).not.toContainText(/等待同步|同步需要处理/);
    await expect.poll(
      () => observations.some((item) => item.entityTypes.includes('entry')),
      { timeout: 30_000, message: '完成后应自动推送 entry，不需要人工重复点击同步' },
    ).toBe(true);

    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.status).toBeGreaterThanOrEqual(200);
      expect(observation.status).toBeLessThan(300);
      expect(observation.error).toBeUndefined();
      expect(observation.resultStatuses).not.toContain('rejected');
      expect(observation.resultStatuses).not.toContain('retry');
      expect(observation.resultStatuses).not.toContain('conflict');
    }

    await clearIndexedDbAndReload(context, page);
    const restoredCard = page.locator('.diary-card').filter({ hasText: marker });
    await expect(restoredCard).toBeVisible({ timeout: 30_000 });
    await waitForIdle(page);
    await expect(restoredCard).not.toContainText(/等待同步|同步需要处理/);
    if (recordEvidence) await showEvidenceNote(page, '服务端回读成功：日记已恢复且同步状态正常');
    await page.screenshot({ path: path.join(artifactDir, 'SYNC-01-server-restored.png'), fullPage: true });

    expect(consoleErrors).toEqual([]);
  } finally {
    await writeFile(
      path.join(artifactDir, 'SYNC-01-network.json'),
      `${JSON.stringify({ marker, observations, consoleErrors }, null, 2)}\n`,
      'utf8',
    );
    await page.close();
    await context.close();
    if (video) {
      videoPath = await video.path().catch(() => null);
      if (videoPath) await copyFile(videoPath, path.join(artifactDir, 'SYNC-01-production-sync.webm'));
    }
    await cleanupEntry(browser, storageState, marker);
  }
});

test('[SYNC-02] 历史退避记录展示原因，并可一次立即重试成功', async ({ browser }) => {
  const storageState = await authenticatedStorage(browser);
  const marker = `E2E-LEGACY-SYNC-${Date.now()}`;
  const observations: PushObservation[] = [];
  const context = await createCaseContext(browser, storageState);
  const page = await context.newPage();
  const video = page.video();
  observePushes(page, observations);

  try {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '一本日记' })).toBeVisible();
    await waitForIdle(page);
    await page.getByRole('button', { name: '写新日记' }).click();
    const editor = page.getByRole('textbox', { name: '日记正文' });
    await editor.fill(`${marker}\n用于验证历史待同步记录的立即重试。`);
    await page.getByRole('button', { name: '完成' }).click();
    await expect(page.locator('.diary-card').filter({ hasText: marker })).toBeVisible();
    await waitForIdle(page);

    observations.length = 0;
    await seedBackedOffDelete(page, marker);
    await page.reload();
    const badge = page.getByRole('button', { name: '部分待同步' });
    await expect(badge).toBeVisible();
    await badge.click();

    const details = page.getByRole('dialog', { name: '同步详情' });
    await expect(details).toBeVisible();
    await expect(details.getByText('日记 · 删除')).toBeVisible();
    await expect(details.getByText('TEMPORARY_FAILURE')).toBeVisible();
    if (recordEvidence) await showEvidenceNote(page, '历史待同步原因已展开：一次点击立即重试');
    await page.screenshot({ path: path.join(artifactDir, 'SYNC-02-pending-details.png'), fullPage: true });

    await details.getByRole('button', { name: '立即重试' }).click();
    await waitForIdle(page);
    await expect.poll(
      () => observations.some((item) => item.entityTypes.includes('entry') && item.resultStatuses.includes('applied')),
      { timeout: 30_000, message: '立即重试应绕过退避时间并推送历史记录' },
    ).toBe(true);
    if (recordEvidence) await showEvidenceNote(page, '立即重试成功：历史队列已清空');
  } finally {
    await page.close();
    await context.close();
    if (video) {
      const videoPath = await video.path().catch(() => null);
      if (videoPath) await copyFile(videoPath, path.join(artifactDir, 'SYNC-02-production-sync.webm'));
    }
    await cleanupEntry(browser, storageState, marker);
  }
});
