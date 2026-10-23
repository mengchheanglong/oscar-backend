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
  console.log('Navigating to /tasks...');
  await page.goto('http://localhost:43100/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const artifactDir = path.resolve(
    'C:/Users/User/.gemini/antigravity/brain/b7e1f7b7-ea15-4319-8273-c85a53d28c1f',
  );

  // Find column elements
  const columns = await page.$$('.rounded-2xl.p-3');
  console.log(`Found ${columns.length} columns`);

  // First draggable card in column 0 (TO DO) using @hello-pangea/dnd attribute
  const firstCard = page.locator('[data-rfd-draggable-id]').first();
  await firstCard.waitFor({ state: 'visible', timeout: 5000 });
  const cardTitle = await firstCard.locator('h4').innerText();
  console.log(`First card title: "${cardTitle}"`);

  // Target second column (IN PROGRESS)
  const targetCol = page.locator('.rounded-2xl.p-3').nth(1);
  const cardBox = await firstCard.boundingBox();
  const targetBox = await targetCol.boundingBox();

  console.log('Executing fluid drag to IN PROGRESS column...');
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);

  // Smooth intermediate steps
  for (let step = 1; step <= 12; step++) {
    const curX = cardBox.x + (targetBox.x + targetBox.width / 2 - cardBox.x) * (step / 12);
    const curY = cardBox.y + (targetBox.y + 150 - cardBox.y) * (step / 12);
    await page.mouse.move(curX, curY);
    await page.waitForTimeout(40);
  }

  // Capture in-flight drag screenshot
  await page.screenshot({
    path: path.join(artifactDir, 'tasks_kanban_dragging_active.png'),
    fullPage: false,
  });
  console.log('In-flight drag screenshot captured.');

  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(2500);

  await page.screenshot({
    path: path.join(artifactDir, 'tasks_kanban_drag_drop_verified.png'),
    fullPage: false,
  });
  console.log('Drag and Drop verified! Settled screenshot captured.');

  await browser.close();
}

main().catch((err) => {
  console.error('Error during DnD verification:', err);
  process.exit(1);
});
