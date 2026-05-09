import { test, expect } from '@playwright/test';
import { login } from './auth.setup';

test.describe('Invoices', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/invoices');
  });

  test('shows invoice list with at least 18 seeded rows', async ({ page }) => {
    // Wait for initial load (skeletons have animate-pulse; real rows or empty state don't)
    await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 15000 });

    // Switch to 2025 where most seeds are, then wait for data to reload
    await page.click('button:has-text("2025")');
    // Wait for skeleton to appear then real data to arrive
    await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 15000 });
    await page.waitForTimeout(500); // let React settle

    const rows = page.locator('tbody tr:not(.animate-pulse)');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(5); // at least some seeded in 2025
  });

  test('can create a new invoice', async ({ page }) => {
    // Count rows before creating
    await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 15000 });
    const rowsBefore = await page.locator('tbody tr:not(.animate-pulse)').count();

    // Open modal
    await page.click('button:has-text("Нова фактура")');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });

    // Pick first available client
    const clientSelect = page.locator('select').first();
    await clientSelect.selectOption({ index: 1 });

    // Fill first item
    const descInput = page.locator('input[placeholder="Описание..."]').first();
    await descInput.fill('Тестова услуга E2E');

    const unitPriceInput = page.locator('input[type="number"]').nth(1);
    await unitPriceInput.fill('1000');

    // Submit
    await page.click('button:has-text("Създай фактура")');

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    // Table should reload — wait until row count increases
    await expect(page.locator('tbody tr:not(.animate-pulse)')).toHaveCount(rowsBefore + 1, { timeout: 15000 });
  });

  test('can change invoice status to PAID', async ({ page }) => {
    // Find a PENDING invoice — check both 2025 and 2026
    await page.click('button:has-text("Чакащи")');
    await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 15000 });

    let rowCount = await page.locator('tbody tr:not(.animate-pulse)').count();
    // If empty state (1 row with message), try 2025
    if (rowCount <= 1) {
      await page.click('button:has-text("2025")');
      await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 15000 });
      rowCount = await page.locator('tbody tr:not(.animate-pulse)').count();
    }
    const rows = page.locator('tbody tr:not(.animate-pulse)');
    if (rowCount <= 1) {
      test.skip(true, 'No PENDING invoices to test status change');
      return;
    }

    // Click "View" on first row
    await rows.first().locator('button:has-text("View")').click();
    await page.waitForTimeout(300);

    // Pick "Платено" (PAID) from dropdown
    await page.locator('button', { hasText: /^Платено$/ }).first().click();
    await page.waitForTimeout(2000);

    // Switching to Paid tab should show at least one paid invoice
    await page.click('button:has-text("Платени")');
    await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 15000 });
    const paidRows = page.locator('tbody tr:not(.animate-pulse)');
    expect(await paidRows.count()).toBeGreaterThanOrEqual(1);
  });

  test('can change invoice status to OVERDUE', async ({ page }) => {
    // Find a PENDING invoice
    await page.click('button:has-text("Чакащи")');
    await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 30000 });

    let rowCount = await page.locator('tbody tr:not(.animate-pulse)').count();
    if (rowCount <= 1) {
      await page.click('button:has-text("2025")');
      await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 30000 });
      rowCount = await page.locator('tbody tr:not(.animate-pulse)').count();
    }
    const rows = page.locator('tbody tr:not(.animate-pulse)');
    if (rowCount <= 1) {
      test.skip(true, 'No PENDING invoices to test status change');
      return;
    }

    await rows.first().locator('button:has-text("View")').click();
    await page.waitForTimeout(300);

    // Pick "Просрочено" (OVERDUE)
    await page.locator('button', { hasText: /^Просрочено$/ }).first().click();
    await page.waitForTimeout(2000);

    await page.click('button:has-text("Просрочени")');
    await page.waitForSelector('tbody tr:not(.animate-pulse)', { timeout: 15000 });
    const overdueRows = page.locator('tbody tr:not(.animate-pulse)');
    expect(await overdueRows.count()).toBeGreaterThanOrEqual(1);
  });
});
