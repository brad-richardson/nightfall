import { expect, test } from "@playwright/test";
import { setupApiMocks } from "./test-utils";

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
        type: "road",
        position: { x: 200, y: 200 }
      }
    }));
  });

  // 3. Verify selection modal (FeaturePanel) appears
  const panelHeading = page.getByRole("heading", { name: "Road Segment" });
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
