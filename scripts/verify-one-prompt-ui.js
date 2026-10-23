const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();

  const artifactDir = path.resolve(
    'C:/Users/User/.gemini/antigravity/brain/b7e1f7b7-ea15-4319-8273-c85a53d28c1f',
  );

  console.log('Navigating to login...');
  await page.goto('http://localhost:43100/login', { waitUntil: 'networkidle' });

  // Fill login
  await page.fill('input[type="email"]', 'admin@example.com');
  await page.fill('input[type="password"]', 'Password123!');
  await page.click('button[type="submit"]');

  console.log('Waiting for login to succeed...');
  await page.waitForTimeout(3000);

  // Nav to MCP App View
  console.log('Navigating to /integrations?app=mcp...');
  await page.goto('http://localhost:43100/integrations?app=mcp', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('Capturing top view integrations_mcp_app_view.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'integrations_mcp_app_view.png'),
    fullPage: false,
  });

  // Scroll to Universal Coding Agent Setup card inside main element
  console.log('Locating Universal Coding Agent Setup card...');
  await page.evaluate(() => {
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTop = 650;
  });
  await page.waitForTimeout(600);

  console.log('Capturing integrations_mcp_one_prompt_card.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'integrations_mcp_one_prompt_card.png'),
    fullPage: false,
  });

  // Click Cursor tab
  const cursorBtn = page.locator('button', { hasText: 'Cursor' });
  if ((await cursorBtn.count()) > 0) {
    await cursorBtn.first().click();
    await page.waitForTimeout(500);
    console.log('Capturing Cursor tab...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_mcp_tab_cursor.png'),
      fullPage: false,
    });
  }

  // Click Claude Code tab
  const claudeBtn = page.locator('button', { hasText: 'Claude Code' });
  if ((await claudeBtn.count()) > 0) {
    await claudeBtn.first().click();
    await page.waitForTimeout(500);
    console.log('Capturing Claude Code tab...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_mcp_tab_claude.png'),
      fullPage: false,
    });
  }

  // Click Codex tab
  const codexBtn = page.locator('button', { hasText: 'Codex' });
  if ((await codexBtn.count()) > 0) {
    await codexBtn.first().click();
    await page.waitForTimeout(500);
    console.log('Capturing Codex tab...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_mcp_tab_codex.png'),
      fullPage: false,
    });
  }

  // Click Antigravity tab
  const agyBtn = page.locator('button', { hasText: 'Antigravity' });
  if ((await agyBtn.count()) > 0) {
    await agyBtn.first().click();
    await page.waitForTimeout(500);
    console.log('Capturing Antigravity tab...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_mcp_tab_antigravity.png'),
      fullPage: false,
    });
  }

  // Switch back to One-Prompt Setup
  const onePromptBtn = page.locator('button', { hasText: 'One-Prompt Setup' });
  if ((await onePromptBtn.count()) > 0) {
    await onePromptBtn.first().click();
    await page.waitForTimeout(500);
    console.log('Capturing One-Prompt setup final...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_mcp_one_prompt_final.png'),
      fullPage: false,
    });
  }

  console.log('All 5 tabs tested and screenshots captured successfully!');
  await browser.close();
}

main().catch((err) => {
  console.error('Error running test script:', err);
  process.exit(1);
});
