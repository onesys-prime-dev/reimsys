// Shared by the browser tests: drive the reimbursement form wizard.

/** Walks the shortest valid path (no BIR invoice) and stops on the last step, "Proof and review". Start on /receipts/new. */
export async function fillQuickForm(page, { payee, amount = '100', date, description } = {}) {
  await page.waitForSelector('.steps');
  await page.getByRole('radio', { name: /^No/ }).first().click();
  await page.click('button:has-text("Next")');
  await page.getByLabel(/Why is there no BIR/).fill('Test receipt with no BIR invoice');
  await page.click('button:has-text("Next")');
  if (date) await page.getByLabel(/date/i).first().fill(date);
  await page.getByLabel('Vendor complete name').fill(payee);
  await page.getByLabel(/Invoice gross amount/).fill(String(amount));
  await page.getByRole('radio', { name: /^Product/ }).first().click();
  await page.click('button:has-text("Next")');
  await page.waitForSelector('.drop');
  if (description) await page.getByLabel(/Description/).fill(description);
}

/** From an edit screen, press Next until the last step. */
export async function toLastStep(page) {
  for (let i = 0; i < 6 && !(await page.locator('.drop').count()); i++) await page.click('button:has-text("Next")');
  await page.waitForSelector('.drop');
}
