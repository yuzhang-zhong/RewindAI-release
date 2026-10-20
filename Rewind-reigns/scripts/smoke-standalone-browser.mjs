import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';

// This smoke deliberately tests only the standalone preset deck. Never provide
// provider credentials, handoff tokens, real accounts, or a hosted target.
const appUrl = new URL(process.env.REWINDAI_GAME_URL || 'http://127.0.0.1:5174');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(appUrl.hostname), 'browser smoke must target a loopback server');
assert.ok(['http:', 'https:'].includes(appUrl.protocol), 'browser smoke requires an HTTP(S) loopback target');
const artifactDir = resolve(process.env.REWINDAI_BROWSER_ARTIFACTS || 'test-results/standalone-browser');
mkdirSync(artifactDir, { recursive: true });
const storageKey = 'mirror-campus-records-v1';
const forbiddenRequests = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.REWINDAI_CHROMIUM_PATH ? { executablePath: process.env.REWINDAI_CHROMIUM_PATH } : {}),
});

async function records(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), storageKey);
}

async function playToEnding(page) {
  await expect(page.locator('.choice-card')).toBeVisible({ timeout: 30000 });
  let previous = 0;
  for (let turn = 0; turn < 24; turn += 1) {
    if (await page.locator('.ending-report-button').isVisible()) break;
    const choices = page.locator('button.hint:not([disabled])');
    await expect(choices.first()).toBeEnabled({ timeout: 15000 });
    await choices.nth(turn % await choices.count()).click();
    await page.waitForFunction(({ key, previous }) => {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      return saved.some(record => record.history.length > previous);
    }, { key: storageKey, previous }, { timeout: 15000 });
    const saved = await records(page);
    previous = Math.max(...saved.map(record => record.history.length));
  }
  await expect(page.locator('.ending-report-button')).toBeVisible({ timeout: 15000 });
  const saved = await records(page);
  const ended = saved.find(record => record.finalState.ended);
  assert.ok(ended && ended.history.length > 0 && ended.history.length <= 24, 'a complete run must persist locally');
  for (const value of Object.values(ended.finalState.meters)) assert.ok(value >= 0 && value <= 100);
  return ended;
}

async function openAndCheckReport(page, label) {
  await page.locator('.ending-report-button').click();
  await expect(page.locator('.records-panel')).toBeVisible();
  await expect(page.locator('.record-detail')).toContainText('Decision trail');
  await expect(page.locator('.records-header')).toContainText('Run report');
  const scroll = await page.locator('.record-detail').evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return { overflows: element.scrollHeight > element.clientHeight, scrolled: element.scrollTop > 0 };
  });
  assert.ok(!scroll.overflows || scroll.scrolled, 'overflowing report content remains scrollable');
  await page.screenshot({ path: join(artifactDir, `${label}-report.png`), fullPage: true });
  await page.locator('.records-header').getByRole('button', { name: 'Continue', exact: true }).click();
}

async function runCase({ label, anonymous, mobile }) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const errors = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== appUrl.origin) return route.abort();
    if (url.pathname === '/api/custom-cards/generate' || url.pathname.startsWith('/api/storysage/')) {
      forbiddenRequests.push(url.pathname);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(appUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Anonymous start', exact: true })).toBeVisible();
    if (anonymous) {
      await page.getByRole('button', { name: 'Anonymous start', exact: true }).click();
    } else {
      await page.getByPlaceholder('Enter your campus name').fill('Synthetic browser smoke');
      await page.getByRole('button', { name: 'Start semester', exact: true }).click();
    }
    const ended = await playToEnding(page);
    console.log(`PASS ${label}: start, choices, ending, and local record (${ended.history.length} decisions)`);
    await openAndCheckReport(page, label);
    console.log(`PASS ${label}: report, decision trail, and overflow scrolling`);
    if (anonymous) {
      await page.getByRole('button', { name: 'Reflect', exact: true }).click();
      await expect(page.locator('.advisor-panel')).toContainText('Self Reflection');
      await page.locator('textarea.reflection-box').fill('Synthetic reflection: protect the lowest resource in the next run.');
      await page.getByRole('button', { name: 'Start second run', exact: true }).click();
      await expect(page.locator('.choice-card')).toBeVisible();
      assert.ok((await records(page)).some(record => record.sessionId === ended.sessionId && record.selfReflection?.text.includes('Synthetic reflection')));
      console.log(`PASS ${label}: self-reflection saves locally before second run`);
    } else {
      await page.getByRole('button', { name: 'Clone', exact: true }).click();
      await expect(page.locator('.advisor-panel')).toContainText('Clone same-question similarity');
      await page.getByRole('button', { name: 'Start assisted replay', exact: true }).click();
      await expect(page.locator('.choice-card')).toBeVisible();
      const original = (await records(page)).find(record => record.sessionId === ended.sessionId);
      const replay = original?.reflection?.clone_replay;
      assert.equal(replay?.protocol, 'rewindai.clone_same_question_replay');
      assert.deepEqual(replay.choices.map(choice => choice.card_id), ended.history.map(item => item.cardId));
      assert.equal(replay.similarity_percent, Math.round(replay.matched_choices / replay.total_questions * 100));
      console.log(`PASS ${label}: heuristic same-card clone similarity saves before second run, without provider calls`);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Records', exact: true }).click();
    await expect(page.locator('.records-panel')).toBeVisible();
    assert.ok((await records(page)).some(record => record.sessionId === ended.sessionId && record.finalState.ended));
    console.log(`PASS ${label}: local records remain available after reload`);
    assert.deepEqual(errors, [], 'standalone flow must not produce uncaught browser errors');
  } catch (error) {
    await page.screenshot({ path: join(artifactDir, `${label}-failure.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await runCase({ label: 'desktop-clone', anonymous: false, mobile: false });
  await runCase({ label: 'mobile-anonymous', anonymous: true, mobile: true });
  assert.deepEqual(forbiddenRequests, [], 'standalone flow must not attempt provider generation or StorySage calls');
  console.log(`PASS standalone browser smoke completed. Screenshots: ${artifactDir}`);
} finally {
  await browser.close();
}
