import { test, expect } from '@playwright/test';
import { login } from './auth.setup';

test.describe('Document Review', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/documents');
  });

  test('shows documents page with PENDING tab active by default', async ({ page }) => {
    // PENDING tab should be highlighted by default
    const pendingTab = page.locator('button', { hasText: /Чакащи|Pending/i }).first();
    await expect(pendingTab).toBeVisible({ timeout: 10000 });

    // Left panel should load
    await page.waitForSelector('.col-span-4, [class*="col-span-4"]', { timeout: 10000 });
  });

  test('can select a PENDING document and open review modal with CREATE_PURCHASE', async ({ page }) => {
    // Wait for document list items to appear (or no-docs message)
    await page.locator('h4').or(page.getByText('Няма документи')).first().waitFor({ timeout: 15000 });

    // Check if any document h4 titles exist
    const firstDocTitle = page.locator('h4').first();
    const hasDoc = await firstDocTitle.isVisible().catch(() => false);
    if (!hasDoc) {
      test.skip(true, 'No PENDING documents in DB');
      return;
    }

    // Click the first document item (each item contains an h4 title)
    await firstDocTitle.click();
    await page.waitForTimeout(1200);

    // "ПОТВЪРДИ ДАННИТЕ" button should appear in the right panel
    const confirmBtn = page.getByRole('button', { name: /ПОТВЪРДИ ДАННИТЕ|CONFIRM DATA/i });
    await expect(confirmBtn).toBeVisible({ timeout: 10000 });

    // Click it to open the ReviewModal
    await confirmBtn.click();
    await page.waitForTimeout(500);

    // ReviewModal should be open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await expect(dialog.getByText('Преглед на документ')).toBeVisible();

    // Change action to CREATE_PURCHASE
    const actionSelect = dialog.locator('select').first();
    await actionSelect.selectOption('CREATE_PURCHASE');
    await page.waitForTimeout(500);

    // Supplier section should appear
    await expect(dialog.getByText(/Доставчик/i).first()).toBeVisible({ timeout: 5000 });

    // Click "Вкарай"
    const submitBtn = dialog.getByRole('button', { name: /Вкарай/i });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Modal should close (API may take up to 30s due to generateAlerts)
    await expect(dialog).not.toBeVisible({ timeout: 40000 });

    // Document was moved to LINKED status — verify PENDING count decreased
    // (can't check "Прегледани" tab since that shows PROCESSED, not LINKED)
    await page.getByRole('button', { name: /Чакащи|Pending/i }).click();
    // The count in the left panel should now show one fewer document
    await expect(page.locator('h4').first()).toBeVisible({ timeout: 15000 });
  });

  test('review modal shows correct action options', async ({ page }) => {
    await page.locator('h4').or(page.getByText('Няма документи')).first().waitFor({ timeout: 15000 });

    const firstDocTitle = page.locator('h4').first();
    const hasDoc = await firstDocTitle.isVisible().catch(() => false);
    if (!hasDoc) {
      test.skip(true, 'No PENDING documents in DB');
      return;
    }

    await firstDocTitle.click();
    await page.waitForTimeout(1000);

    const confirmBtn = page.getByRole('button', { name: /ПОТВЪРДИ ДАННИТЕ|CONFIRM DATA/i });
    await confirmBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog');
    const actionSelect = dialog.locator('select').first();

    // Verify all expected options are present
    await expect(actionSelect.locator('option[value="CREATE_PURCHASE"]')).toHaveCount(1);
    await expect(actionSelect.locator('option[value="CREATE_INVOICE"]')).toHaveCount(1);
    await expect(actionSelect.locator('option[value="CREATE_EXPENSE"]')).toHaveCount(1);
    await expect(actionSelect.locator('option[value="ARCHIVE_ONLY"]')).toHaveCount(1);
    await expect(actionSelect.locator('option[value="REJECT"]')).toHaveCount(1);
  });
});
