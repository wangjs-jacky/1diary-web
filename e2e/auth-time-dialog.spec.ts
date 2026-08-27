import { expect, test, type Browser, type Page } from '@playwright/test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.ONE_DIARY_E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const recordEvidence = process.env.ONE_DIARY_E2E_RECORD === '1';
const artifactDir = path.resolve(
  process.env.ONE_DIARY_E2E_ARTIFACT_DIR ?? 'artifacts/web-e2e/auth-time-dialog',
);

function credentials() {
  const loginEmail = process.env.ONE_DIARY_E2E_EMAIL;
  const loginPassword = process.env.ONE_DIARY_E2E_PASSWORD;
  const registrationEmail = process.env.ONE_DIARY_E2E_REGISTRATION_EMAIL;
  const registrationPassword = process.env.ONE_DIARY_E2E_REGISTRATION_PASSWORD;
  if (!loginEmail || !loginPassword || !registrationEmail || !registrationPassword) {
    throw new Error('登录与注册的一次性 E2E 凭据未配置');
  }
  return { loginEmail, loginPassword, registrationEmail, registrationPassword };
}

async function maskCredentialInputs(page: Page) {
  await page.addStyleTag({
    content: 'input[type="email"], input[type="password"], input[type="text"] { color: transparent !important; text-shadow: none !important; }',
  });
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

async function verifyRegistration(browser: Browser) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const { registrationEmail, registrationPassword } = credentials();
  try {
    if (process.env.ONE_DIARY_E2E_STUB_SIGNUP === '1') {
      await page.route('**/auth/v1/signup**', async (route) => {
        const now = new Date().toISOString();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: '018f6b6a-7e02-7abc-8def-000000000001',
            aud: 'authenticated',
            role: 'authenticated',
            email: registrationEmail,
            phone: '',
            confirmation_sent_at: now,
            app_metadata: { provider: 'email', providers: ['email'] },
            user_metadata: {},
            identities: [],
            created_at: now,
            updated_at: now,
          }),
        });
      });
    }
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '一本日记' })).toBeVisible();
    await page.getByRole('button', { name: '创建账号' }).click();
    await expect(page.getByRole('button', { name: '创建并开始记录' })).toBeVisible();
    await page.screenshot({ path: path.join(artifactDir, '01-register-form.png'), fullPage: true });

    await maskCredentialInputs(page);
    await page.getByLabel('邮箱').fill(registrationEmail);
    await page.getByLabel('密码', { exact: true }).fill(registrationPassword);
    await page.getByLabel('确认密码', { exact: true }).fill(registrationPassword);
    await page.getByRole('button', { name: '创建并开始记录' }).click();
    await expect(page.getByRole('status')).toContainText('注册成功，请检查邮箱完成验证');
    await page.screenshot({ path: path.join(artifactDir, '02-register-success.png'), fullPage: true });
  } finally {
    await context.close();
  }
}

async function authenticatedStorage(browser: Browser) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const { loginEmail, loginPassword } = credentials();
  try {
    await page.goto('/');
    await maskCredentialInputs(page);
    await page.getByLabel('邮箱').fill(loginEmail);
    await page.getByLabel('密码', { exact: true }).fill(loginPassword);
    await page.getByRole('button', { name: '进入日记' }).click();
    await expect(page.getByRole('link', { name: '一本日记' })).toBeVisible({ timeout: 30_000 });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

test('[AUTH-TIME-01] 注册、登录与时间弹窗形成完整用户路径', async ({ browser }) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });
  await verifyRegistration(browser);
  const storageState = await authenticatedStorage(browser);
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport: { width: 1440, height: 900 },
    ...(recordEvidence ? { recordVideo: { dir: path.join(artifactDir, 'raw-video'), size: { width: 1440, height: 900 } } } : {}),
  });
  const page = await context.newPage();
  const video = page.video();
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  try {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '一本日记' })).toBeVisible();
    await page.getByRole('button', { name: '写新日记' }).click();

    const timeTrigger = page.getByRole('button', { name: /设置时间，当前 \d{2}:\d{2}/ });
    await expect(timeTrigger).toBeVisible();
    const initialLabel = await timeTrigger.getAttribute('aria-label');
    const initialTime = initialLabel?.match(/(\d{2}):(\d{2})/)?.slice(1).map(Number);
    expect(initialTime).toHaveLength(2);
    const nextHour = ((initialTime?.[0] ?? 0) + 2) % 24;
    const nextMinute = ((initialTime?.[1] ?? 0) + 7) % 60;
    const expectedTime = `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;

    await timeTrigger.click();
    let dialog = page.getByRole('dialog', { name: '设置日记时间' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '现在' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '取消' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '确定' })).toBeVisible();
    if (recordEvidence) await showEvidenceNote(page, '时间使用独立弹窗，取消不会修改日记');
    await page.screenshot({ path: path.join(artifactDir, '03-time-dialog.png'), fullPage: true });

    await dialog.getByRole('textbox', { name: '小时' }).fill(String(nextHour));
    await dialog.getByRole('textbox', { name: '分钟' }).fill(String(nextMinute));
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(timeTrigger).toHaveAttribute('aria-label', initialLabel ?? '');

    await timeTrigger.click();
    dialog = page.getByRole('dialog', { name: '设置日记时间' });
    await dialog.getByRole('textbox', { name: '小时' }).fill(String(nextHour));
    await dialog.getByRole('textbox', { name: '分钟' }).fill(String(nextMinute));
    await dialog.getByRole('button', { name: '确定' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(timeTrigger).toHaveAttribute('aria-label', `设置时间，当前 ${expectedTime}`);
    if (recordEvidence) await showEvidenceNote(page, `确认后时间更新为 ${expectedTime}`);
    await page.screenshot({ path: path.join(artifactDir, '04-time-confirmed.png'), fullPage: true });

    expect(consoleErrors).toEqual([]);
  } finally {
    await writeFile(
      path.join(artifactDir, 'AUTH-TIME-01-result.json'),
      `${JSON.stringify({ consoleErrors }, null, 2)}\n`,
      'utf8',
    );
    await page.close();
    await context.close();
    if (video) {
      const source = await video.path().catch(() => null);
      if (source) await copyFile(source, path.join(artifactDir, 'AUTH-TIME-01.webm'));
    }
  }
});
