const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.type(), msg.text()));
  page.on('response', async (res) => {
    if (res.url().includes('/tasks')) {
      console.log('TASKS RESPONSE URL:', res.url(), 'STATUS:', res.status());
      try {
        const json = await res.json();
        console.log('TASKS JSON:', JSON.stringify(json).substring(0, 200));
      } catch (e) {}
    }
  });

  console.log('Navigating to login...');
  await page.goto('http://localhost:43100/login', { waitUntil: 'networkidle' });

  // Fill login
  await page.fill('input[type="email"]', 'admin@example.com');
  await page.fill('input[type="password"]', 'Password123!');
  await page.click('button[type="submit"]');

  console.log('Logged in, opening the task board...');
  await page.waitForTimeout(2000);

  console.log('Navigating to /tasks...');
  await page.goto('http://localhost:43100/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const artifactDir = path.resolve(
    'C:/Users/User/.gemini/antigravity/brain/b7e1f7b7-ea15-4319-8273-c85a53d28c1f',
  );

  // Screenshot 1: Board View default (collapsed)
  console.log('Capturing board view default...');
  await page.screenshot({
    path: path.join(artifactDir, 'tasks_new_board_view.png'),
    fullPage: false,
  });

  // Expand TO DO
  const todoExpand = await page.$('text=+ 4 more');
  if (todoExpand) {
    console.log('Expanding TO DO column...');
    await todoExpand.click();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(artifactDir, 'tasks_new_board_todo_expanded.png'),
      fullPage: false,
    });
    // collapse back
    const showLess = await page.$('text=Show less');
    if (showLess) await showLess.click();
    await page.waitForTimeout(400);
  }

  // Switch to List View
  console.log('Switching to List view...');
  const listBtn = await page.$('button:has-text("List")');
  if (listBtn) {
    await listBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(artifactDir, 'tasks_new_list_view.png'),
      fullPage: false,
    });
  }

  console.log('Verification screenshots captured successfully!');
  await browser.close();
}

main().catch((err) => {
  console.error('Error during verification:', err);
  process.exit(1);
});
