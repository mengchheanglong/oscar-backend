const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  page.on('console', (msg) => console.log('BROWSER LOG:', msg.type(), msg.text()));

  console.log('Logging in...');
  await page.goto('http://localhost:43100/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'admin@example.com');
  await page.fill('input[type="password"]', 'Password123!');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(2000);
  console.log('Navigating to /documents...');
  await page.goto('http://localhost:43100/documents', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const artifactDir = path.resolve(
    'C:/Users/User/.gemini/antigravity/brain/b7e1f7b7-ea15-4319-8273-c85a53d28c1f',
  );

  // 1. Screenshot Grid view
  await page.screenshot({
    path: path.join(artifactDir, 'documents_page_grid_verified.png'),
    fullPage: false,
  });
  console.log('Documents grid view screenshot captured.');

  // 2. Switch to List view
  console.log('Switching to List view...');
  const listButton = page.locator('button:has-text("List")');
  await listButton.click();
  await page.waitForTimeout(1000);

  await page.screenshot({
    path: path.join(artifactDir, 'documents_page_list_verified.png'),
    fullPage: false,
  });
  console.log('Documents list view screenshot captured.');

  // 3. Switch back to Grid view and open Document Details modal
  console.log('Switching back to Grid and opening details modal...');
  const gridButton = page.locator('button:has-text("Grid")');
  await gridButton.click();
  await page.waitForTimeout(1000);

  const firstCard = page.locator('div[class*="rounded-2xl border border-slate-200"]').first();
  await firstCard.click();
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: path.join(artifactDir, 'documents_detail_modal_verified.png'),
    fullPage: false,
  });
  console.log('Documents detail modal screenshot captured.');

  // Close modal
  const closeBtn = page.locator('button:has(svg.lucide-x)').first();
  await closeBtn.click();
  await page.waitForTimeout(1000);

  // 4. Click "Upload Document" button to test upload modal
  console.log('Opening Upload Document modal...');
  const uploadButton = page.locator('button:has-text("Upload Document")').first();
  await uploadButton.click();
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: path.join(artifactDir, 'documents_upload_modal_verified.png'),
    fullPage: false,
  });
  console.log('Documents upload modal screenshot captured.');

  await browser.close();
  console.log('Documents UI verification completed successfully!');
}

main().catch((err) => {
  console.error('Error during documents verification:', err);
  process.exit(1);
});
