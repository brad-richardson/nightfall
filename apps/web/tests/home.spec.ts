import { expect, test } from "@playwright/test";
import { setupApiMocks } from "./test-utils";

test("home page renders", async ({ page }) => {
  // Set up API mocks before navigating
  await setupApiMocks(page);

  await page.goto("/");

  // With mocked data, we should see the main game headline
  const headline = page.getByRole("heading", {
    name: /the city endures\. the nights get longer\./i
  });

  await expect(headline).toBeVisible();
});
