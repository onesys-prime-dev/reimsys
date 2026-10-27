// Shared by the browser tests: drive the reimbursement form wizard.

/** Walks the shortest valid path (no BIR invoice) and stops on the last step, "Proof and review". Start on /receipts/new. */
export async function fillQuickForm(page, { payee, amount = '100', date, description } = {}) {
  await page.waitForSelector('.steps');
  await page.getByRole('radio', { name: /^No/ }).first().click();
  await page.click('button:has-text("Next")');
  if (date) await page.getByLabel(/date/i).first().fill(date);
  await page.getByLabel('Vendor complete name').fill(payee);
  await page.getByLabel('Vendor complete address').fill('Test Street, Test City');
  await page.getByLabel(/Amount paid to vendor/).fill(String(amount));
  await page.click('button:has-text("Next")');
  await page.getByLabel('Specific reason for spending').fill('Test receipt');
  await page.getByRole('radio', { name: /^Fuel/ }).first().click();
  await page.click('button:has-text("Next")');
  await page.waitForSelector('.drop');
  if (description) await page.getByLabel(/Description/).fill(description);
  await completeLastPage(page);
}

/** The last page also asks where to charge, and for the person's own review. */
export async function completeLastPage(page) {
  await page.getByLabel('Choose where to charge').selectOption({ index: 1 });
  await page.getByRole('radiogroup', { name: 'Review the details' }).getByRole('radio', { name: /^Yes/ }).click();
}

/** From an edit screen, press Next until the last step. */
export async function toLastStep(page) {
  for (let i = 0; i < 6 && !(await page.locator('.drop').count()); i++) await page.click('button:has-text("Next")');
  await page.waitForSelector('.drop');
  // An edited receipt asks for the review again.
  await page.getByRole('radiogroup', { name: 'Review the details' }).getByRole('radio', { name: /^Yes/ }).click();
}
