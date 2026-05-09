import { Page } from '@playwright/test';

export const CREDENTIALS = {
  email: 'office@studiobotema.com',
  password: 'TestBotema2024!',
};

export async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', CREDENTIALS.email);
  await page.fill('input[type="password"]', CREDENTIALS.password);
  await page.click('button[type="submit"]');
  // Wait until redirected away from login
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });
}
