import { describe, expect, it } from "vitest";
import { getCrewLayers, getCrewPathLayers } from "./layers";

describe("crew layers", () => {
  it("returns three crew layers with correct configuration", () => {
    const layers = getCrewLayers();

    expect(layers).toHaveLength(3);

    // Shadow layer under badge
    expect(layers[0].id).toBe("game-crews-shadow");
    expect(layers[0].type).toBe("circle");

    // Working pulse layer (only shows when working)
    expect(layers[1].id).toBe("game-crews-working-pulse");
    expect(layers[1].type).toBe("circle");
    expect(layers[1].filter).toEqual(["==", ["get", "status"], "working"]);

    // Icon layer
    expect(layers[2].id).toBe("game-crews-icon");
    expect(layers[2].type).toBe("symbol");
    expect((layers[2] as { layout?: { "icon-image"?: string } }).layout?.["icon-image"]).toBe("construction-vehicle");
  });

  it("returns three crew path layers with correct configuration", () => {
    const layers = getCrewPathLayers();

    expect(layers).toHaveLength(3);

    // Path line layer
    expect(layers[0].id).toBe("game-crew-path-line");
    expect(layers[0].type).toBe("line");

    // Shadow under moving crew badge
    expect(layers[1].id).toBe("game-crew-path-shadow");
    expect(layers[1].type).toBe("circle");

    // Moving crew icon
    expect(layers[2].id).toBe("game-crew-path-icon");
    expect(layers[2].type).toBe("symbol");
    expect((layers[2] as { layout?: { "icon-image"?: string } }).layout?.["icon-image"]).toBe("construction-vehicle");
  });

  it("crew icon layer does not rotate (badge stays upright)", () => {
    const layers = getCrewLayers();
    const iconLayer = layers[2];

    const layout = (iconLayer as { layout?: { "icon-rotate"?: unknown } }).layout;
    // No rotation specified - badge stays upright
    expect(layout?.["icon-rotate"]).toBeUndefined();
  });
});
