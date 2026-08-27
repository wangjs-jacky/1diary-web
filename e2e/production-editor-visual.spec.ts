import { expect, test, type Browser, type Page } from '@playwright/test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.ONE_DIARY_E2E_BASE_URL ?? 'http://121.43.32.242:3080';
const recordEvidence = process.env.ONE_DIARY_E2E_RECORD === '1';
const artifactDir = path.resolve(
  process.env.ONE_DIARY_E2E_ARTIFACT_DIR ?? 'artifacts/web-e2e/production-editor-visual',
);

function credentials() {
  const email = process.env.ONE_DIARY_E2E_EMAIL;
  const password = process.env.ONE_DIARY_E2E_PASSWORD;
  if (!email || !password) throw new Error('ONE_DIARY_E2E_EMAIL and ONE_DIARY_E2E_PASSWORD are required');
  return { email, password };
}

async function authenticatedStorage(browser: Browser) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const { email, password } = credentials();
  await page.goto('/');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入日记' }).click();
  await expect(page.getByRole('link', { name: '一本日记' })).toBeVisible({ timeout: 30_000 });
  const storageState = await context.storageState();
  await context.close();
  return storageState;
}

async function waitForIdle(page: Page) {
  await expect(page.locator('.sync-badge')).toContainText('已同步', { timeout: 30_000 });
}

async function showEvidenceNote(page: Page, text: string) {
  await page.evaluate((message) => {
    document.querySelector('[data-e2e-note]')?.remove();
    const note = document.createElement('div');
    note.dataset.e2eNote = 'true';
    note.textContent = message;
    Object.assign(note.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '99999',
      padding: '10px 18px', borderRadius: '999px', color: '#fff', background: 'rgba(44, 58, 55, .92)',
      font: '14px sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.2)',
    });
    document.body.append(note);
  }, text);
  await page.waitForTimeout(900);
}

async function cleanupEntry(browser: Browser, storageState: Awaited<ReturnType<typeof authenticatedStorage>>, marker: string) {
  const context = await browser.newContext({ baseURL, storageState, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    await page.goto('/');
    const card = page.locator('.diary-card').filter({ hasText: marker });
    if (await card.count()) {
      await card.hover();
      await card.getByRole('button', { name: '删除日记' }).click();
      await expect(card).toHaveCount(0);
      await waitForIdle(page);
    }
  } finally {
    await context.close();
  }
}

test('[EDITOR-VISUAL-01] 图标、四级标题、任务列表和日历形成统一 Web 体验', async ({ browser }) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });
  const storageState = await authenticatedStorage(browser);
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport: { width: 1440, height: 900 },
    ...(recordEvidence ? { recordVideo: { dir: path.join(artifactDir, 'raw-video'), size: { width: 1440, height: 900 } } } : {}),
  });
  const page = await context.newPage();
  const video = page.video();
  const marker = `E2E-EDITOR-${Date.now()}`;
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  try {
    await page.goto('/');
    const brand = page.getByRole('link', { name: '一本日记' });
    await expect(brand.locator('svg[data-brand-mark="one-diary"]')).toBeVisible();
    for (const name of ['搜索', '切换主题', '更多', '写新日记']) {
      await expect(page.getByRole('button', { name }).locator('svg[data-icon-name]')).toBeVisible();
    }

    await page.getByRole('button', { name: '更多' }).click();
    await expect(page.getByRole('link', { name: /日历/ }).locator('svg[data-icon-name="calendar"]')).toBeVisible();
    if (recordEvidence) await showEvidenceNote(page, '统一的品牌标识与 Lucide Web 图标');
    else await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(artifactDir, '01-icon-system.png'), fullPage: true });

    await page.getByRole('button', { name: '写新日记' }).click();
    const editor = page.getByRole('textbox', { name: '日记正文' });
    await expect(editor).toBeVisible();
    for (const name of ['一级标题', '二级标题', '三级标题', '四级标题', '任务列表']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }

    await page.getByRole('button', { name: '一级标题' }).click();
    await editor.pressSequentially(`${marker} 一本日记`);
    await editor.press('Enter');
    await page.getByRole('button', { name: '二级标题' }).click();
    await editor.pressSequentially('今天的章节');
    await editor.press('Enter');
    await page.getByRole('button', { name: '三级标题' }).click();
    await editor.pressSequentially('正在发生');
    await editor.press('Enter');
    await page.getByRole('button', { name: '四级标题' }).click();
    await editor.pressSequentially('细小但重要');
    await editor.press('Enter');
    await page.getByRole('button', { name: '任务列表' }).click();
    await editor.pressSequentially('保留未完成事项');
    await editor.press('Enter');
    await editor.pressSequentially('记录已经完成的事');

    const taskCheckboxes = editor.getByRole('checkbox');
    await expect(taskCheckboxes).toHaveCount(2);
    await taskCheckboxes.nth(1).click();
    await expect(taskCheckboxes.nth(1)).toBeChecked();
    if (recordEvidence) await showEvidenceNote(page, 'H1–H4 与可勾选任务列表，保存为 Markdown');
    await page.screenshot({ path: path.join(artifactDir, '02-editor-markdown.png'), fullPage: true });

    await page.getByRole('button', { name: '完成' }).click();
    const card = page.locator('.diary-card').filter({ hasText: marker });
    await expect(card).toBeVisible();
    await waitForIdle(page);
    await expect(card.locator('h1')).toContainText(marker);
    await expect(card.locator('h2')).toHaveText('今天的章节');
    await expect(card.locator('h3')).toHaveText('正在发生');
    await expect(card.locator('h4')).toHaveText('细小但重要');
    await expect(card.getByRole('checkbox')).toHaveCount(2);
    await expect(card.getByRole('checkbox').nth(1)).toBeChecked();

    await page.getByRole('button', { name: '更多' }).click();
    await page.getByRole('link', { name: /日历/ }).click();
    const calendar = page.locator('.journal-calendar');
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('.calendar-entry-count').first()).toContainText(/\d+ 篇/);
    await expect(calendar.getByRole('button', { name: '上个月' }).locator('svg[data-icon-name="previous-month"]')).toBeVisible();
    await expect(calendar.getByRole('button', { name: '下个月' }).locator('svg[data-icon-name="next-month"]')).toBeVisible();
    if (recordEvidence) await showEvidenceNote(page, '日历使用组件化月份导航、今日状态与日记计数');
    await page.screenshot({ path: path.join(artifactDir, '03-calendar.png'), fullPage: true });

    expect(consoleErrors).toEqual([]);
  } finally {
    await writeFile(path.join(artifactDir, 'EDITOR-VISUAL-01-result.json'), `${JSON.stringify({ marker, consoleErrors }, null, 2)}\n`);
    await page.close();
    await context.close();
    if (video) {
      const source = await video.path().catch(() => null);
      if (source) await copyFile(source, path.join(artifactDir, 'EDITOR-VISUAL-01.webm'));
    }
    await cleanupEntry(browser, storageState, marker);
  }
});
