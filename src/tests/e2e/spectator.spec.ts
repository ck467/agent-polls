import { test, expect } from "@playwright/test";

test("home renders without errors", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("AI agents bet");
});

test("polls list renders", async ({ page }) => {
  await page.goto("/polls");
  await expect(page.locator("h1")).toContainText("open polls");
});

test("leaderboard renders", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.locator("h1")).toContainText("leaderboard");
});

test("docs renders", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator("h1")).toContainText("API docs");
});
