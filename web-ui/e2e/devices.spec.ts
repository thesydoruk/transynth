import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURE_MOD_ID, mockApi } from './mockApi';

/*
 * Every page has to be usable on every device in playwright.config.ts:
 * nothing pushes the page wider than the screen, the top bar's controls stay
 * on screen and big enough to tap, and the page renders without a script error.
 */

type PageCase = {
  name: string;
  path: string;
  /** Something that proves the page drew its data, not a spinner. */
  ready: (page: Page) => Locator;
};

const text = (t: string | RegExp) => (page: Page) => page.getByText(t).first();
const heading = (page: Page) => page.locator('main').getByRole('heading').first();

const PAGES: PageCase[] = [
  { name: 'games', path: '/', ready: text('Fallout 4') },
  { name: 'game hub', path: '/games/fo4', ready: text('Fallout 4') },
  { name: 'mods', path: '/games/fo4/mods', ready: text('Unofficial Fallout 4 Patch') },
  { name: 'mod editor', path: `/games/fo4/mods/${FIXTURE_MOD_ID}`, ready: text('Settler 1') },
  {
    name: 'mod editor: dialogs',
    path: `/games/fo4/mods/${FIXTURE_MOD_ID}?mode=dialogs`,
    ready: text('MinRecruit02Scene01'),
  },
  {
    name: 'mod editor: voice',
    path: `/games/fo4/mods/${FIXTURE_MOD_ID}?mode=voice`,
    ready: text('Sturges (MaleEvenToned)'),
  },
  { name: 'nexus', path: '/games/fo4/nexus', ready: heading },
  { name: 'diff', path: '/games/fo4/diff', ready: heading },
  { name: 'coherence', path: '/games/fo4/coherence', ready: heading },
  { name: 'reference', path: '/games/fo4/reference', ready: text('Settler 1') },
  { name: 'glossary', path: '/glossary', ready: text('Commonwealth Minutemen General') },
  { name: 'settings: general', path: '/settings?tab=general', ready: heading },
  { name: 'settings: llm', path: '/settings?tab=llm', ready: text(/Qwen3-30B/) },
  { name: 'settings: voice', path: '/settings?tab=voice', ready: text(/ai-pipeline\.local:8020/) },
  { name: 'settings: workflow', path: '/settings?tab=workflow', ready: heading },
  { name: 'settings: qa rules', path: '/settings?tab=qaRules', ready: text(/Pip-Boy name column/) },
  { name: 'settings: activity', path: '/settings?tab=activity', ready: heading },
  { name: 'system log', path: '/system-log', ready: text(/timed out after 120000 ms/) },
  { name: 'not found', path: '/no-such-page', ready: heading },
];

/** WCAG 2.2 AA minimum target size (2.5.8), in CSS px. */
const MIN_TARGET = 24;

const open = async (page: Page, path: string) => {
  // Ukrainian is the default UI language and the one with the longest labels.
  await page.addInitScript(() => localStorage.setItem('ui-lang', 'uk'));
  const unmocked = await mockApi(page);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(path);
  return { unmocked, errors };
};

/** Elements that stick out past the right edge of the screen, widest first. */
const overflowingElements = (page: Page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const found: { el: string; right: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= vw + 1) continue;
      // Content inside a scroll box may be wider than the screen; that is the point of the box.
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
      found.push({
        el: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`,
        right: Math.round(rect.right),
      });
    }
    return found.sort((a, b) => b.right - a.right).slice(0, 5);
  });

for (const pc of PAGES) {
  test.describe(pc.name, () => {
    test('fits the screen without sideways scrolling', async ({ page }) => {
      const { unmocked, errors } = await open(page, pc.path);
      await expect(pc.ready(page)).toBeVisible();

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        `page is ${scrollWidth}px wide on a ${clientWidth}px screen; widest offenders: ${JSON.stringify(
          await overflowingElements(page),
        )}`,
      ).toBeLessThanOrEqual(clientWidth + 1);

      expect(errors, 'console errors').toEqual([]);
      expect(unmocked, 'API calls the fake backend does not answer').toEqual([]);
    });

    test('keeps the top bar on screen and tappable', async ({ page }) => {
      await open(page, pc.path);
      await expect(pc.ready(page)).toBeVisible();
      const viewport = page.viewportSize()!;

      const nav = page.getByRole('navigation').first();
      const controls = [
        nav.getByRole('link', { name: 'Transynth' }),
        nav.locator('a[href="/settings"]'),
        nav.locator('a[href="/system-log"]'),
        nav.getByRole('button').first(),
        nav.getByRole('combobox'),
      ];
      for (const control of controls) {
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        const label = await control.evaluate((el) => el.outerHTML.slice(0, 80));
        expect(box.x, `${label} starts off screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label} ends off screen`).toBeLessThanOrEqual(
          viewport.width + 1,
        );
        expect(box.width, `${label} is too narrow to tap`).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(box.height, `${label} is too short to tap`).toBeGreaterThanOrEqual(MIN_TARGET);
      }
    });
  });
}

test('a user can get from the game list to a mod and into settings', async ({ page }) => {
  await open(page, '/');
  await page.getByText('Fallout 4').first().click();
  await expect(page).toHaveURL(/\/games\/fo4$/);

  await page.goto('/games/fo4/mods');
  await page.getByText('Unofficial Fallout 4 Patch').first().click();
  await expect(page).toHaveURL(/\/games\/fo4\/mods\/2$/);
  await expect(page.getByText('Settler 1').first()).toBeVisible();

  await page.getByRole('navigation').locator('a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
});

test.describe('mod editor', () => {
  test('gives the string grid most of the screen width', async ({ page }) => {
    await open(page, `/games/fo4/mods/${FIXTURE_MOD_ID}`);
    const row = page.locator('[data-index="1"]');
    await expect(row).toBeVisible();
    const vw = page.viewportSize()!.width;
    const box = (await row.boundingBox())!;
    const onScreen = Math.min(box.x + box.width, vw) - Math.max(box.x, 0);
    expect(onScreen, `grid rows get ${Math.round(onScreen)}px of ${vw}px`).toBeGreaterThanOrEqual(
      vw * 0.6,
    );

    // The columns a translator works in, not just metadata, must be on screen.
    for (const col of ['src', 'transl']) {
      const cell = (await row.locator(`[data-col="${col}"]`).boundingBox())!;
      expect(cell, `the ${col} column is hidden`).not.toBeNull();
      expect(cell.width, `the ${col} column is too narrow to read`).toBeGreaterThanOrEqual(80);
      expect(cell.x + cell.width, `the ${col} column ends off screen`).toBeLessThanOrEqual(vw + 1);
    }
  });

  test('keeps the mod name and AI actions in the toolbar', async ({ page }) => {
    await open(page, `/games/fo4/mods/${FIXTURE_MOD_ID}`);
    const name = page.getByText(/^Sim Settlements 2/).first();
    await expect(name).toBeVisible();
    const box = (await name.boundingBox())!;
    expect(box.width, 'the mod name is squeezed to nothing').toBeGreaterThanOrEqual(60);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });

  test('opens a line for translation with a tap or a double-click', async ({ page }, info) => {
    await open(page, `/games/fo4/mods/${FIXTURE_MOD_ID}`);
    const row = page.locator('[data-index="1"]');
    await expect(row).toBeVisible();
    if (info.project.use.hasTouch) await row.tap();
    else await row.dblclick();

    const editor = page.locator('textarea:not([readonly])').first();
    await expect(editor).toBeVisible();
    await editor.scrollIntoViewIfNeeded();
    const box = (await editor.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x + box.width, 'translation box ends off screen').toBeLessThanOrEqual(
      viewport.width + 1,
    );
    expect(box.height, 'translation box is too short to type in').toBeGreaterThanOrEqual(40);

    await editor.fill('Поселенець');
    await expect(editor).toHaveValue('Поселенець');
  });
});

/** A box lies inside the viewport, give or take a pixel. */
const inViewport = (
  box: { x: number; y: number; width: number; height: number },
  vw: number,
  vh: number,
) => box.x >= -1 && box.y >= -1 && box.x + box.width <= vw + 1 && box.y + box.height <= vh + 1;

test.describe('mod editor row actions', () => {
  test('the row menu opens from a button and fits the screen', async ({ page }, info) => {
    await open(page, `/games/fo4/mods/${FIXTURE_MOD_ID}`);
    const row = page.locator('[data-index="1"]');
    await expect(row).toBeVisible();
    if (info.project.use.hasTouch) await row.tap();
    else await row.dblclick();

    await page.getByRole('button', { name: 'Дії з рядком' }).click();
    const menu = page.locator('[class*="ctxMenu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Очистити переклад')).toBeVisible();
    const { width, height } = page.viewportSize()!;
    const box = (await menu.boundingBox())!;
    expect(inViewport(box, width, height), `menu at ${JSON.stringify(box)} leaves the screen`).toBe(
      true,
    );
  });

  test('on a phone an open row is a full-screen sheet with a way back', async ({ page }) => {
    const { width, height } = page.viewportSize()!;
    test.skip(width > 720, 'phones only');
    await open(page, `/games/fo4/mods/${FIXTURE_MOD_ID}`);
    const row = page.locator('[data-index="1"]');
    await row.tap();

    const back = page.getByRole('button', { name: 'До списку' });
    await expect(back).toBeVisible();
    const sheet = (await page.locator('[class*="detailPanel_"]').first().boundingBox())!;
    // Desktop WebKit draws a classic scrollbar inside the sheet; allow for it.
    expect(sheet.x, 'sheet does not start at the left edge').toBeLessThanOrEqual(1);
    expect(sheet.width, 'sheet is narrower than the screen').toBeGreaterThanOrEqual(width - 20);
    expect(sheet.height, 'sheet is shorter than the screen').toBeGreaterThanOrEqual(height * 0.9);
    await expect(page.locator('textarea:not([readonly])').first()).toBeVisible();

    await back.tap();
    await expect(back).toBeHidden();
    await expect(row).toBeVisible();
  });
});

test('settings open on the tab named in the address, and that tab is on screen', async ({
  page,
}) => {
  await open(page, '/settings?tab=activity');
  const tab = page.getByRole('button', { name: 'Активність' }).first();
  await expect(tab).toBeVisible();
  const { width, height } = page.viewportSize()!;
  expect(inViewport((await tab.boundingBox())!, width, height)).toBe(true);
});

test.describe('tables', () => {
  test('a glossary row edits without scrolling sideways', async ({ page }) => {
    await open(page, '/glossary');
    const edit = page.getByRole('button', { name: /Редагувати/ }).first();
    await expect(edit).toBeVisible();
    const { width } = page.viewportSize()!;
    const editBox = (await edit.boundingBox())!;
    expect(editBox.x + editBox.width, 'the edit button starts off screen').toBeLessThanOrEqual(
      width + 1,
    );
    await edit.click();
    const inputs = page.locator('tbody input[type="text"], tbody input:not([type])');
    await expect(inputs.first()).toBeVisible();
    for (const input of await inputs.all()) {
      const box = (await input.boundingBox())!;
      expect(box.x, 'an edit field starts off screen').toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, 'an edit field ends off screen').toBeLessThanOrEqual(width + 1);
    }
  });

  test('reference rows keep their buttons on screen', async ({ page }) => {
    await open(page, '/games/fo4/reference');
    const edit = page.getByRole('button', { name: /Редагувати/ }).first();
    await expect(edit).toBeVisible();
    const { width } = page.viewportSize()!;
    const box = (await edit.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  });
});
