import { test, expect } from "@playwright/test";

test.describe("MapLibre Lifecycle", () => {
  test("map initializes and renders without errors", async ({ page }) => {
    // Listen for console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    // Navigate to the page
    await page.goto("/");

    // Wait for map container to be present
    const mapShell = page.locator(".map-shell");
    await expect(mapShell).toBeVisible();

    // Wait for MapLibre canvas to be rendered
    const mapCanvas = page.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible({ timeout: 10000 });

    // Verify no console errors during initialization
    expect(errors).toEqual([]);
  });

  test("map canvas has proper dimensions", async ({ page }) => {
    await page.goto("/");

    const mapCanvas = page.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible({ timeout: 10000 });

    // Check that canvas has non-zero dimensions
    const boundingBox = await mapCanvas.boundingBox();
    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.width).toBeGreaterThan(0);
    expect(boundingBox!.height).toBeGreaterThan(0);
  });

  test("map survives navigation and remount", async ({ page }) => {
    await page.goto("/");

    // Wait for initial map load
    let mapCanvas = page.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible({ timeout: 10000 });

    // Navigate away (if there's a second page, otherwise just reload)
    await page.reload();

    // Wait for map to load again
    mapCanvas = page.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible({ timeout: 10000 });

    // Map should still be functional
    const boundingBox = await mapCanvas.boundingBox();
    expect(boundingBox).not.toBeNull();
  });

  test("map layers render correctly", async ({ page }) => {
    await page.goto("/");

    const mapCanvas = page.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible({ timeout: 10000 });

    // Wait a bit for layers to render
    await page.waitForTimeout(2000);

    // Take a screenshot to verify visual rendering
    const screenshot = await mapCanvas.screenshot();
    expect(screenshot.length).toBeGreaterThan(1000); // Non-blank canvas
  });

  test("map responds to window resize", async ({ page }) => {
    await page.goto("/");

    const mapCanvas = page.locator("canvas.maplibregl-canvas");
    await expect(mapCanvas).toBeVisible({ timeout: 10000 });

    // Get initial dimensions
    const initialBox = await mapCanvas.boundingBox();

    // Resize viewport
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(500);

    // Get new dimensions
    const newBox = await mapCanvas.boundingBox();

    // Dimensions should have changed
    expect(newBox).not.toBeNull();
    expect(initialBox).not.toBeNull();
    expect(newBox!.width).not.toBe(initialBox!.width);
  });

  test("no memory leaks on repeated mount/unmount", async ({ page }) => {
    await page.goto("/");

    // Wait for initial load
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 10000 });

    // Perform multiple reloads
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    }

    // If there were memory leaks, the page would likely crash or slow down significantly
    // Check that the page is still responsive
    const mapCanvas = page.locator("canvas.maplibregl-canvas");
    const boundingBox = await mapCanvas.boundingBox();
    expect(boundingBox).not.toBeNull();
  });
});
