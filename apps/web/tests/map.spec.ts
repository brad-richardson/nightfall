import { expect, test } from "@playwright/test";
import { setupApiMocks } from "./test-utils";

test("attribution bubble auto-retracts after 4 seconds", async ({ page }) => {
  await setupApiMocks(page);
  await page.goto("/");

  // Wait for map to load
  const mapCanvas = page.locator(".maplibregl-canvas");
  await expect(mapCanvas).toBeVisible();

  // Find the compact attribution control
  const attribControl = page.locator(".maplibregl-ctrl-attrib.maplibregl-compact");
  await expect(attribControl).toBeVisible();

  // Click to expand the attribution bubble
  const attribButton = page.locator(".maplibregl-ctrl-attrib-button");
  await expect(attribButton).toBeVisible();
  await attribButton.click();

  // Verify it expanded (has maplibregl-compact-show class)
  await expect(attribControl).toHaveClass(/maplibregl-compact-show/);

  // Wait for auto-retract (4 seconds + buffer)
  await page.waitForTimeout(4500);

  // Verify it collapsed (no longer has maplibregl-compact-show class)
  await expect(attribControl).not.toHaveClass(/maplibregl-compact-show/);
});

test("attribution bubble clears timeout on manual collapse", async ({ page }) => {
  await setupApiMocks(page);
  await page.goto("/");

  // Wait for map to load
  const mapCanvas = page.locator(".maplibregl-canvas");
  await expect(mapCanvas).toBeVisible();

  const attribControl = page.locator(".maplibregl-ctrl-attrib.maplibregl-compact");
  await expect(attribControl).toBeVisible();
  const attribButton = page.locator(".maplibregl-ctrl-attrib-button");
  await expect(attribButton).toBeVisible();

  // Expand the bubble
  await attribButton.click();
  await expect(attribControl).toHaveClass(/maplibregl-compact-show/);

  // Wait 2 seconds (less than the 4 second auto-retract)
  await page.waitForTimeout(2000);

  // Manually collapse by clicking the close button
  await attribButton.click();

  // Verify it collapsed
  await expect(attribControl).not.toHaveClass(/maplibregl-compact-show/);

  // Wait another 3 seconds to ensure no error from stale timeout
  await page.waitForTimeout(3000);

  // Should still be collapsed (no unexpected state changes)
  await expect(attribControl).not.toHaveClass(/maplibregl-compact-show/);
});

test("map renders and features are selectable", async ({ page }) => {
  // Set up API mocks before navigating
  await setupApiMocks(page);

  await page.goto("/");

  // 1. Wait for map to be visible
  const mapCanvas = page.locator(".maplibregl-canvas");
  await expect(mapCanvas).toBeVisible();

  // 2. Test feature selection via custom event dispatch
  // (Simulating a map click that successfully hits a feature)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
      detail: { 
        gers_id: "test-feature-id", 
        type: "building",
        position: { x: 200, y: 200 }
      }
    }));
  });

  // 3. Verify selection modal (FeaturePanel) appears
  const panelHeading = page.getByRole("heading", { name: "Building" });
  await expect(panelHeading).toBeVisible();
  await expect(page.getByText("test-feature-id")).toBeVisible();

  // 4. Test closing the selection
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
      detail: null
    }));
  });
  await expect(panelHeading).not.toBeVisible();
});
