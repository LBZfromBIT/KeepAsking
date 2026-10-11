// End-to-end test: drives the real Electron app against the mock SSE server.
// Prereqs: `npm run build` and `npm run mock` (port 8787). On Linux CI/headless run under `xvfb-run`.
//   APP_EXECUTABLE=/path/to/packaged/binary  -> test a packaged build instead of out/main/index.js
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const SHOT = process.env.SHOT || 'e2e-screenshot.png';
const userData = process.env.BRANCHCHAT_USER_DATA || mkdtempSync(join(tmpdir(), 'branchchat-e2e-'));
const exe = process.env.APP_EXECUTABLE;
const electronPath = createRequire(import.meta.url)('electron');

const app = await electron.launch({
  executablePath: exe || electronPath,
  args: [...(exe ? [] : ['.']), '--no-sandbox'],
  env: { ...process.env, BRANCHCHAT_USER_DATA: userData },
});
const page = await app.firstWindow();
await page.setViewportSize?.({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
page.on('dialog', (d) => { console.log('DIALOG:', d.message()); void d.accept(); });
app.process().stderr?.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
const step = (s) => console.log('✓', s);
console.log('userData:', userData);

async function selectText(page, scopeSel, needle) {
  await page.evaluate(({ scopeSel, needle }) => {
    const scopes = [...document.querySelectorAll(scopeSel)];
    for (const scope of scopes.reverse()) {
      const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.data.indexOf(needle);
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          document.querySelector('.messages').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          return;
        }
      }
    }
    throw new Error('text not found: ' + needle);
  }, { scopeSel, needle });
}

const waitIdle = () => page.waitForFunction(() => !document.querySelector('.typing') && !document.querySelector('.composer .danger'));
const nodeCount = () => page.locator('[data-testid=tree] .tree-node').count();

await page.waitForSelector('.app');
// Security: renderer has no Node, only the preload API
assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
assert.equal(await page.evaluate(() => typeof window.api?.chat?.start), 'function');
step('contextIsolation: no Node in renderer, window.api exposed');

// Configure BYOK settings
await page.click('[data-testid=open-settings]');
await page.fill('input[name=apiKey]', 'sk-test-123');
await page.fill('input[name=baseUrl]', `${MOCK}/v1`);
await page.fill('input[name=model]', 'mock-model');
await page.click('.modal button.primary');
await page.waitForSelector('.modal', { state: 'detached' });
step('settings saved');

// Root question, streamed
await page.fill('.composer textarea', '解释一下 Transformer 的注意力机制');
await page.keyboard.press('Enter');
await page.waitForSelector('.msg-assistant .markdown h1');
await waitIdle();
const rootText = await page.locator('.msg-assistant .markdown').innerText();
assert.match(rootText, /缩放点积注意力/);
assert.ok(await page.locator('.msg-assistant pre code.hljs').count(), 'code highlighted');
step('streaming root answer rendered with markdown + code highlighting');

// Branch 1 via quick button
await selectText(page, '.msg-assistant .markdown', '查询向量');
await page.click('.branch-pop button.primary');
await page.waitForSelector('.branch-banner');
await waitIdle();
assert.match(await page.locator('.msg-assistant .markdown').last().innerText(), /关于「查询向量」/);
assert.equal(await nodeCount(), 2);
step('branch 1 created from selection, streamed answer, tree has 2 nodes');

// Nested branch 2 via follow-up question
await selectText(page, '.msg-assistant .markdown', '的应用');
await page.click('.branch-pop button:has-text("追问")');
await page.fill('.branch-pop input', '举个实际例子');
await page.click('.branch-pop button[type=submit]');
await page.waitForFunction(() => document.querySelectorAll('.crumbs .crumb').length === 3);
await waitIdle();
assert.equal(await nodeCount(), 3);
step('nested branch 2 created with follow-up question');

// Check the context sent to the API for the nested branch
const reqs = await (await fetch(`${MOCK}/requests`)).json();
const last = reqs[reqs.length - 1];
assert.equal(last.headers.authorization, 'Bearer sk-test-123');
assert.equal(last.body.model, 'mock-model');
assert.equal(last.body.stream, true);
const roles = last.body.messages.map((m) => m.role).join(',');
assert.equal(roles, 'system,user,assistant,user,assistant,user', 'context = root history + branch1 history + new focus');
assert.match(last.body.messages[1].content, /Transformer/);
assert.match(last.body.messages[3].content, /> 查询向量/);
assert.match(last.body.messages[5].content, /> 的应用[\s\S]*举个实际例子/);
step('branch context = ancestor history up to anchor + quoted selection + question');

// Navigate to root via tree, verify highlighted span & clicking it jumps to branch
const rootId = await page.locator('[data-testid=tree] .tree-node').evaluateAll((els) => els.find((e) => e.textContent.includes('🌳')).dataset.nodeId);
await page.click(`[data-testid=tree] .tree-node[data-node-id="${rootId}"]`);
await page.waitForSelector('mark.branch-mark');
assert.equal((await page.locator('mark.branch-mark').innerText()).trim(), '查询向量');
await page.click('mark.branch-mark');
await page.waitForSelector('.branch-banner');
step('parent shows highlighted span; clicking it jumps into the branch');

// API key must never reach the renderer
const st = await page.evaluate(() => window.api.settings.get());
assert.equal(st.hasApiKey, true);
assert.ok(!JSON.stringify(st).includes('sk-test-123'));
step(`API key stored encrypted (storage: ${st.keyStorage}), not exposed to renderer`);

// Persistence after reload (data.json in userData)
await page.reload();
await page.waitForSelector('[data-testid=tree] .tree-node');
assert.equal(await nodeCount(), 3);
step('state persisted to userData/data.json across reload');

// Screenshot: show branch 1 with the root context highlighted
await page.click(`[data-testid=tree] .tree-node[data-node-id="${rootId}"]`);
await page.evaluate(() => (document.querySelector('.messages').scrollTop = 0));
await selectText(page, '.msg-assistant .markdown', '多头注意力');
await page.waitForSelector('.branch-pop');
await page.waitForTimeout(500);
await page.screenshot({ path: SHOT });
step('screenshot saved to ' + SHOT);
await page.click('mark.branch-mark');
await page.waitForSelector('.branch-banner');
await page.waitForTimeout(300);
const SHOT2 = SHOT.replace(/\.png$/, '-branch.png');
await page.screenshot({ path: SHOT2 });
step('branch view screenshot saved to ' + SHOT2);

// Anthropic-style provider
await page.click('[data-testid=open-settings]');
await page.selectOption('.modal select', 'anthropic');
await page.click('.modal button.primary');
await page.waitForSelector('.modal', { state: 'detached' });
await page.click('.session');
await page.fill('.composer textarea', '再总结一下');
await page.keyboard.press('Enter');
await waitIdle();
const areq = (await (await fetch(`${MOCK}/requests`)).json()).pop();
assert.ok(areq.url.endsWith('/messages'));
assert.equal(areq.headers['x-api-key'], 'sk-test-123');
assert.match(await page.locator('.msg-assistant .markdown').last().innerText(), /注意力机制简介/);
step('Anthropic-style /messages streaming works');
await page.click('[data-testid=open-settings]');
await page.selectOption('.modal select', 'openai');
await page.click('.modal button.primary');
await page.waitForSelector('.modal', { state: 'detached' });

await app.close();
console.log('ALL TESTS PASSED');
