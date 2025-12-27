import { describe, expect, it } from "vitest";
import { getCrewLayers, getCrewPathLayers } from "./layers";

describe("crew layers", () => {
  it("returns three crew layers with correct configuration", () => {
    const layers = getCrewLayers();

    expect(layers).toHaveLength(3);

    // Glow layer for working crews
    expect(layers[0].id).toBe("game-crews-glow");
    expect(layers[0].type).toBe("circle");
    expect(layers[0].filter).toEqual(["==", ["get", "status"], "working"]);

    // Status ring layer
    expect(layers[1].id).toBe("game-crews-ring");
    expect(layers[1].type).toBe("circle");

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

    // Moving crew ring
    expect(layers[1].id).toBe("game-crew-path-ring");
    expect(layers[1].type).toBe("circle");

    // Moving crew icon
    expect(layers[2].id).toBe("game-crew-path-icon");
    expect(layers[2].type).toBe("symbol");
    expect((layers[2] as { layout?: { "icon-image"?: string } }).layout?.["icon-image"]).toBe("construction-vehicle");
  });

  it("crew icon layer supports rotation via bearing", () => {
    const layers = getCrewLayers();
    const iconLayer = layers[2];

    const layout = (iconLayer as { layout?: { "icon-rotate"?: unknown } }).layout;
    expect(layout?.["icon-rotate"]).toEqual(["coalesce", ["get", "bearing"], 0]);
  });
});
