const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

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

  // 1. Apps Directory View
  console.log('Navigating to /integrations (App Directory)...');
  await page.goto('http://localhost:43100/integrations', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('Capturing integrations_apps_directory.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'integrations_apps_directory.png'),
    fullPage: false,
  });

  // 2. Search filtering: Type "mcp"
  console.log('Testing search filter with "mcp"...');
  const searchInput = page.locator('input[placeholder="Search apps & tools..."]');
  if ((await searchInput.count()) > 0) {
    await searchInput.fill('mcp');
    await page.waitForTimeout(600);
    console.log('Capturing integrations_directory_search_mcp.png...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_directory_search_mcp.png'),
      fullPage: false,
    });
    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(400);
  }

  // 3. Filtered Category View (Version Control & Git)
  console.log('Clicking "Version Control & Git" filter...');
  const vcsFilterBtn = page.locator('button', { hasText: 'Version Control & Git' });
  if ((await vcsFilterBtn.count()) > 0) {
    await vcsFilterBtn.first().click();
    await page.waitForTimeout(600);
    console.log('Capturing integrations_directory_vcs.png...');
    await page.screenshot({
      path: path.join(artifactDir, 'integrations_directory_vcs.png'),
      fullPage: false,
    });
  }

  // 4. MCP App View
  console.log('Navigating to MCP App View (?app=mcp)...');
  await page.goto('http://localhost:43100/integrations?app=mcp', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  console.log('Capturing integrations_mcp_app_view.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'integrations_mcp_app_view.png'),
    fullPage: false,
  });

  // 5. GitHub App View
  console.log('Navigating to GitHub App View (?app=github)...');
  await page.goto('http://localhost:43100/integrations?app=github', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  console.log('Capturing integrations_github_app_view.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'integrations_github_app_view.png'),
    fullPage: false,
  });

  console.log('All verification captures completed successfully!');
  await browser.close();
}

main().catch((err) => {
  console.error('Error running test script:', err);
  process.exit(1);
});
