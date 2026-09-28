import { test, expect, _electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFixtureModelServer } from '../fixtures/openai-server';
test('Chinese UI configures a model, executes a tool and stops streaming', async ({}, info) => {
  const directory = mkdtempSync(join(tmpdir(), 'fastgpt-ui-')), server = await startFixtureModelServer();
  const app = await _electron.launch({ args: [resolve('apps/desktop')], env: { ...process.env, FASTGPT_DESKTOP_TEST_DATA_DIR: directory } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '模型设置', exact: true }).click({ timeout: 2000 });
    await page.getByLabel('模型名称', { exact: true }).fill('本地测试模型');
    await page.getByLabel('Base URL', { exact: true }).fill(server.baseUrl);
    await page.getByLabel('模型 ID', { exact: true }).fill('fixture-model');
    await page.getByLabel('API Key', { exact: true }).fill('fixture-ui-secret');
    await page.getByLabel('允许明文 HTTP（仅可信服务）').check();
    await page.getByLabel('支持工具调用').check();
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByText('密钥仅本次运行可用', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '关闭设置' }).click();
    await page.getByRole('button', { name: '新建会话', exact: true }).click();
    await page.getByRole('textbox', { name: '消息' }).fill('现在是什么时间');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByTestId('run-status')).toHaveText('已完成');
    await expect(page.getByText('工具执行成功，这是测试回复。', { exact: true })).toBeVisible();
    await expect(page.getByText('get_current_time', { exact: true }).first()).toBeVisible();
    await page.getByRole('textbox', { name: '消息' }).fill('慢一点回复'); await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('p').filter({ hasText: /^正在生成$/ })).toBeVisible(); await page.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByTestId('run-status')).toHaveText('已取消');
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('fixture-ui-secret');
    await page.screenshot({ path: info.outputPath('desktop.png') });
  } finally { await app.close(); await server.close(); rmSync(directory, { recursive: true, force: true }); }
});
