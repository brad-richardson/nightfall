#!/usr/bin/env npx tsx
/**
 * Screenshot Utility
 *
 * Spins up the dev server, waits for it to be ready, and takes a screenshot.
 *
 * Usage:
 *   npx tsx scripts/screenshot.ts [options]
 *
 * Options:
 *   --output=PATH    Output file path (default: ./screenshots/screenshot.png)
 *   --width=N        Viewport width (default: 1400)
 *   --height=N       Viewport height (default: 900)
 *   --wait=N         Extra wait time in ms after page load (default: 5000)
 *   --url=PATH       URL path to screenshot (default: /)
 *   --no-server      Don't start dev server (assumes it's already running)
 */

import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

const DEFAULT_OUTPUT = path.resolve(process.cwd(), "screenshots/screenshot.png");
const BASE_URL = "http://127.0.0.1:3000";

interface Options {
  output: string;
  width: number;
  height: number;
  wait: number;
  urlPath: string;
  startServer: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    output: DEFAULT_OUTPUT,
    width: 1400,
    height: 900,
    wait: 5000,
    urlPath: "/",
    startServer: true,
  };

  for (const arg of args) {
    if (arg.startsWith("--output=")) {
      options.output = path.resolve(process.cwd(), arg.split("=")[1]);
    } else if (arg.startsWith("--width=")) {
      options.width = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--height=")) {
      options.height = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--wait=")) {
      options.wait = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--url=")) {
      options.urlPath = arg.split("=")[1];
    } else if (arg === "--no-server") {
      options.startServer = false;
    }
  }

  return options;
}

async function startServer(
  name: string,
  command: string[],
  readyPatterns: string[]
): Promise<ChildProcess> {
  console.log(`Starting ${name}...`);

  const server = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log(`${name} startup timeout - continuing anyway`);
      resolve(server);
    }, 30000);

    const checkReady = (data: Buffer) => {
      const output = data.toString();
      for (const pattern of readyPatterns) {
        if (output.includes(pattern)) {
          clearTimeout(timeout);
          console.log(`${name} ready!`);
          resolve(server);
          return;
        }
      }
    };

    server.stdout?.on("data", checkReady);
    server.stderr?.on("data", checkReady);

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function startAllServers(): Promise<ChildProcess[]> {
  const servers: ChildProcess[] = [];

  // Start API server first
  const api = await startServer(
    "API server",
    ["pnpm", "--filter", "@nightfall/api", "dev"],
    ["Server listening", "listening at", "3001"]
  );
  servers.push(api);

  // Wait for API to actually be responding
  console.log("Waiting for API server (port 3001)...");
  const apiReady = await waitForServer("http://127.0.0.1:3001/api/world", 30);
  if (!apiReady) {
    console.warn("API server may not be ready - continuing anyway");
  }

  // Start web server
  const web = await startServer(
    "Web server",
    ["PORT=3000 pnpm --filter @nightfall/web dev"],
    ["Ready in", "started server", "Local:", "ready started"]
  );
  servers.push(web);

  // Give Next.js extra time to be fully ready
  console.log("Giving Next.js time to initialize...");
  await new Promise((r) => setTimeout(r, 5000));

  return servers;
}

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  console.log(`Waiting for ${url} to be available...`);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        console.log(`Server is responding! (status: ${response.status})`);
        return true;
      }
      console.log(`  Attempt ${i + 1}: status ${response.status}`);
    } catch (e: any) {
      console.log(`  Attempt ${i + 1}: ${e.code || e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return false;
}

async function takeScreenshot(page: Page, outputPath: string): Promise<void> {
  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  await page.screenshot({
    path: outputPath,
    fullPage: true,
  });

  console.log(`Screenshot saved: ${outputPath}`);
}

async function main() {
  const options = parseArgs();
  let servers: ChildProcess[] = [];
  let browser: Browser | null = null;

  try {
    // Start servers if needed
    if (options.startServer) {
      servers = await startAllServers();
      // Give servers a moment to fully initialize
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Wait for web server to respond (longer timeout as Next.js can be slow to start)
    const serverReady = await waitForServer(BASE_URL, 60);
    if (!serverReady) {
      throw new Error("Server did not become available");
    }

    // Launch browser
    console.log("Launching browser...");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    const page = await context.newPage();

    // Navigate to the page, retrying until it loads successfully
    const fullUrl = `${BASE_URL}${options.urlPath}`;
    console.log(`Navigating to ${fullUrl}...`);

    // Retry loop - Next.js dev mode needs time to compile on first load
    let retries = 0;
    const maxRetries = 10;
    while (retries < maxRetries) {
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

      // Check if the page has actual content (not an error or loading state)
      const bodyText = await page.textContent("body");
      if (bodyText && !bodyText.includes("error") && !bodyText.includes("refreshing")) {
        console.log("Page loaded successfully!");
        break;
      }

      retries++;
      console.log(`  Page not ready (attempt ${retries}/${maxRetries}), waiting...`);
      await page.waitForTimeout(3000);
    }

    // Wait for content to render (maps, tiles, etc.)
    console.log(`Waiting ${options.wait}ms for content to fully load...`);
    await page.waitForTimeout(options.wait);

    // Take screenshot
    await takeScreenshot(page, options.output);

    console.log("\nDone!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    // Cleanup
    if (browser) {
      await browser.close();
    }
    if (servers.length > 0) {
      console.log("Shutting down servers...");
      servers.forEach((s) => s.kill("SIGTERM"));
    }
  }
}

main();
