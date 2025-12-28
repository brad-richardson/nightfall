import { test, expect } from "@playwright/test";
import { setupApiMocks } from "./test-utils";

test.describe("Resource Convoy Animation", () => {
  // Increase timeout for CI which is slower
  test.setTimeout(60000);

  test("convoy appears on map when resource transfer event is dispatched", async ({ page }) => {
    // Set up API mocks before navigating
    await setupApiMocks(page);

    await page.goto("/");

    // Wait for map canvas to be visible
    const mapCanvas = page.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible({ timeout: 15000 });

    // Wait for the map to be fully ready (isLoaded state set)
    await page.waitForFunction(
      () => (window as any).__MAP_READY__ === true,
      { timeout: 30000 }
    );

    // Small delay for React to re-render with updated isLoaded state
    await page.waitForTimeout(100);

    // Dispatch a resource transfer event with timestamps starting in the past
    // to ensure the animation is already in progress
    const result = await page.evaluate(() => {
      const now = Date.now();
      const transfer = {
        transfer_id: "test-convoy-" + now,
        region_id: "bar_harbor_me_usa_demo",
        source_gers_id: null,
        hub_gers_id: null,
        resource_type: "materials",
        amount: 100,
        depart_at: new Date(now - 1000).toISOString(),
        arrive_at: new Date(now + 10000).toISOString(),
        path_waypoints: [
          { coord: [-68.21, 44.39], arrive_at: new Date(now - 1000).toISOString() },
          { coord: [-68.22, 44.38], arrive_at: new Date(now + 5000).toISOString() },
          { coord: [-68.23, 44.37], arrive_at: new Date(now + 10000).toISOString() }
        ]
      };
      window.dispatchEvent(new CustomEvent("nightfall:resource_transfer", { detail: transfer }));
      return { transferId: transfer.transfer_id };
    });

    // Wait for animation loop to process and update GeoJSON source
    await page.waitForTimeout(1000);

    // Check if the GeoJSON source has convoy features
    const featureCount = await page.evaluate(() => {
      const map = (window as any).__MAP_INSTANCE__;
      if (!map) return -1;
      const source = map.getSource("game-resource-packages");
      if (!source) return -2;
      const data = source._data;
      const features = data?.geojson?.features || data?.features || [];
      return features.length;
    });

    expect(featureCount).toBeGreaterThan(0);
  });
});
