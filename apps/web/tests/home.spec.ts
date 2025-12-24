import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /the city endures\. the nights get longer\./i })
  ).toBeVisible();
});
