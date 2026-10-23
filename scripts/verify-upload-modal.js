const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const artifactDir = path.resolve(
    'C:/Users/User/.gemini/antigravity/brain/b7e1f7b7-ea15-4319-8273-c85a53d28c1f',
  );

  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

  console.log('Navigating to login...');
  await page.goto('http://localhost:43100/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Check if we need to login
  if (page.url().includes('/login')) {
    console.log('Filling login form...');
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    console.log('After login click, URL is:', page.url());
  }

  // Nav to Documents
  console.log('Navigating to /documents...');
  await page.goto('http://localhost:43100/documents', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click Upload button (it says "Upload Document")
  console.log('Opening Upload Modal...');
  const uploadBtn = page
    .locator('button:has-text("Upload Document"), button:has-text("Upload")')
    .first();
  await uploadBtn.waitFor({ state: 'visible', timeout: 10000 });
  await uploadBtn.click();
  await page.waitForTimeout(800);

  // 1. Capture Initial State (Image 1 & 2)
  console.log('Capturing documents_upload_modal_initial.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'documents_upload_modal_initial.png'),
    fullPage: false,
  });

  // 2. Simulate oversized file (> 10 MB)
  console.log('Simulating oversized file selection...');
  // Create a dummy oversized file buffer in memory
  const oversizedPath = path.join(__dirname, 'Scanned-Whiteboard.jpg');
  // 11 MB dummy file
  const buffer = Buffer.alloc(11 * 1024 * 1024);
  fs.writeFileSync(oversizedPath, buffer);

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(oversizedPath);
  await page.waitForTimeout(500);

  // 2. Capture Error State (Image 3)
  console.log('Capturing documents_upload_modal_error.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'documents_upload_modal_error.png'),
    fullPage: false,
  });

  // Clean up dummy file
  if (fs.existsSync(oversizedPath)) {
    fs.unlinkSync(oversizedPath);
  }

  // 3. Test Retry button
  console.log('Testing Retry button...');
  const retryBtn = page.locator('button', { hasText: 'Retry' });
  if ((await retryBtn.count()) > 0) {
    await retryBtn.first().click();
    await page.waitForTimeout(400);
    console.log('Capturing documents_upload_modal_retried.png...');
    await page.screenshot({
      path: path.join(artifactDir, 'documents_upload_modal_retried.png'),
      fullPage: false,
    });
  }

  // 4. Close upload modal
  console.log('Closing upload modal...');
  const cancelUploadBtn = page.locator('button:has-text("Cancel")').last();
  await cancelUploadBtn.click();
  await page.waitForTimeout(500);

  // 5. Switch to List view to test Delete modal
  console.log('Switching to List view...');
  const listBtn = page.locator('button:has-text("List")').first();
  await listBtn.click();
  await page.waitForTimeout(600);

  // 6. Click Delete icon button
  console.log('Triggering Delete document modal...');
  const deleteBtn = page.locator('button[title="Delete document"]').first();
  await deleteBtn.click();
  await page.waitForTimeout(600);

  // 7. Capture Delete modal ("Indexing Status")
  console.log('Capturing documents_delete_indexing_status_modal.png...');
  await page.screenshot({
    path: path.join(artifactDir, 'documents_delete_indexing_status_modal.png'),
    fullPage: false,
  });

  // 8. Cancel delete
  const cancelDeleteBtn = page.locator('button:has-text("Cancel")').last();
  await cancelDeleteBtn.click();
  await page.waitForTimeout(400);

  console.log('All modal verifications completed successfully!');
  await browser.close();
}

main().catch((err) => {
  console.error('Error running test script:', err);
  process.exit(1);
});
