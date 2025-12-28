import { expect, test } from "@playwright/test";
import { setupApiMocks } from "./test-utils";

/** Dismiss the onboarding overlay by setting localStorage before page load */
async function skipOnboarding(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("nightfall_onboarding_seen", "true");
  });
}

test.describe("Mobile sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await skipOnboarding(page);
  });

  test("trigger button is visible on mobile viewport", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile-only test");

    await page.goto("/");

    // The mobile sidebar trigger should be visible
    const trigger = page.getByRole("button", { name: /region status/i });
    await expect(trigger).toBeVisible();
  });

  test("viewport has viewport-fit=cover for safe area support", async ({ page }) => {
    await page.goto("/");

    // Check that the viewport meta tag includes viewport-fit=cover
    const viewportContent = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewportContent).toContain("viewport-fit=cover");
  });

  test("mobile sidebar container has safe area padding", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile-only test");

    await page.goto("/");

    // Find the mobile sidebar container (parent of the trigger button)
    const container = page.locator('[style*="safe-area-inset-bottom"]').first();
    await expect(container).toBeVisible();

    // Verify the style includes safe area padding
    const style = await container.getAttribute("style");
    expect(style).toContain("env(safe-area-inset-bottom)");
  });

  test("drawer opens and shows content", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile-only test");

    await page.goto("/");

    // Click the trigger to open drawer
    const trigger = page.getByRole("button", { name: /region status/i });
    await trigger.click();

    // Drawer content should be visible - look for Resource Pools heading
    const resourcePoolsHeading = page.getByText(/resource pools/i).first();
    await expect(resourcePoolsHeading).toBeVisible();
  });

  test("drawer content has safe area padding", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile-only test");

    await page.goto("/");

    // Open the drawer
    const trigger = page.getByRole("button", { name: /region status/i });
    await trigger.click();

    // Find the drawer content container with safe area padding
    const drawerContent = page.locator('[style*="calc(2rem + env(safe-area-inset-bottom))"]');
    await expect(drawerContent).toBeVisible();
  });

  test("mobile sidebar is hidden on desktop", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop-only test");

    await page.goto("/");

    // The mobile sidebar trigger should not be visible on desktop
    const trigger = page.getByRole("button", { name: /region status/i });
    await expect(trigger).not.toBeVisible();
  });
});
