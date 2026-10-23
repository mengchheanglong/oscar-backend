const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
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

  // Scroll to "What You Can Ask Your Coding Agent To Do" section
  console.log('Scrolling to capabilities section...');
  await page.evaluate(() => {
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTop = 1200;
  });
  await page.waitForTimeout(800);

  console.log('Capturing integrations_mcp_capabilities_section.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'integrations_mcp_capabilities_section.png'),
    fullPage: false,
  });

  // Test clicking the first "Copy Prompt" button
  console.log('Clicking Copy Prompt button...');
  const copyButtons = page.locator('button', { hasText: 'Copy Prompt' });
  if ((await copyButtons.count()) > 0) {
    await copyButtons.first().click();
    await page.waitForTimeout(400);
    console.log('Capturing integrations_mcp_prompt_copied.png...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_mcp_prompt_copied.png'),
      fullPage: false,
    });
  }

  console.log('Verification completed successfully!');
  await browser.close();
}

main().catch((err) => {
  console.error('Error running test script:', err);
  process.exit(1);
});
