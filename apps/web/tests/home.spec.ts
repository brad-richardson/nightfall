import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  const headline = page
    .getByRole("heading", { name: /the city endures\. the nights get longer\./i })
    .or(page.getByRole("heading", { name: /awaiting data/i }));

  await expect(headline).toBeVisible();
});
