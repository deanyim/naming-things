import { test, expect, type Page } from "@playwright/test";

async function setupPlayer(page: Page, name: string) {
  await page.goto("/");
  await page.getByPlaceholder("your display name").fill(name);
}

async function startSoloRun(page: Page, category: string) {
  await page.goto("/solo");
  await expect(
    page.getByPlaceholder("enter a category (e.g. fruits, countries)"),
  ).toBeVisible({ timeout: 5000 });
  await page
    .getByPlaceholder("enter a category (e.g. fruits, countries)")
    .fill(category);
  await page.getByRole("button", { name: "10s", exact: true }).click();
  await page.getByRole("button", { name: "start run" }).click();
  await page.waitForURL(/\/solo\/run\/[a-z]+-[a-z]+-[a-z]+$/);
  await expect(
    page.getByPlaceholder("type an answer..."),
  ).toBeVisible({ timeout: 5000 });
}

async function submitAnswer(page: Page, text: string) {
  const input = page.getByPlaceholder("type an answer...");
  await expect(input).toBeEnabled({ timeout: 5000 });
  await input.fill(text);
  await input.press("Enter");
}

async function waitForResults(page: Page) {
  await expect(
    page.getByRole("heading", { name: "results" }),
  ).toBeVisible({ timeout: 15000 });
}

test.describe("Solo mode", () => {
  test("home page has solo mode entry point", async ({ page }) => {
    await page.goto("/");
    const soloButton = page.getByRole("button", { name: "play solo" });
    await expect(soloButton).toBeVisible();
    await soloButton.click();
    await page.waitForURL("/solo");
    await expect(
      page.getByRole("heading", { name: "solo mode" }),
    ).toBeVisible();
  });

  test("can start a solo run and submit answers", async ({ page }) => {
    await setupPlayer(page, "SoloPlayer");
    await startSoloRun(page, "fruits");

    await submitAnswer(page, "apple");
    await expect(page.getByText("answers (1)")).toBeVisible({ timeout: 2000 });

    await submitAnswer(page, "banana");
    await expect(page.getByText("answers (2)")).toBeVisible({ timeout: 2000 });

    await submitAnswer(page, "cherry");
    await expect(page.getByText("answers (3)")).toBeVisible({ timeout: 2000 });
  });

  test("input stays focused after submitting an answer", async ({ page }) => {
    await setupPlayer(page, "FocusPlayer");
    await startSoloRun(page, "fruits");

    await submitAnswer(page, "apple");
    await expect(page.getByText("answers (1)")).toBeVisible({ timeout: 2000 });

    // Input should be focused — verify by typing without clicking the input
    await page.keyboard.type("banana");
    await expect(
      page.getByPlaceholder("type an answer..."),
    ).toHaveValue("banana");
  });

  test("duplicate answers are rejected", async ({ page }) => {
    await setupPlayer(page, "DupPlayer");
    await startSoloRun(page, "colors");

    await submitAnswer(page, "red");
    await expect(page.getByText("answers (1)")).toBeVisible({ timeout: 2000 });

    await submitAnswer(page, "red");
    await expect(page.getByText("Duplicate answer")).toBeVisible({
      timeout: 2000,
    });
    await expect(page.getByText("answers (1)")).toBeVisible();
  });

  test("run auto-finishes and shows scored results", async ({ page }) => {
    test.setTimeout(30000);
    await setupPlayer(page, "TimerPlayer");
    await startSoloRun(page, "animals");

    // Submit with waits so each mutation completes before the next
    await submitAnswer(page, "cat");
    await expect(page.getByText("answers (1)")).toBeVisible({ timeout: 2000 });
    await submitAnswer(page, "dog");
    await expect(page.getByText("answers (2)")).toBeVisible({ timeout: 2000 });
    await submitAnswer(page, "zzinvalid thing");
    await expect(page.getByText("answers (3)")).toBeVisible({ timeout: 2000 });

    // Wait for auto-finish
    await waitForResults(page);

    // Answers should be listed with labels
    await expect(page.getByText("cat", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("dog", { exact: true })).toBeVisible();

    // Invalid badge should appear
    const invalidBadge = page
      .locator("span.rounded-full")
      .filter({ hasText: "invalid" });
    await expect(invalidBadge).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByRole("button", { name: "play again" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "view all leaderboards" }),
    ).toBeVisible();
  });

  test("leaderboard updates after finished runs", async ({ browser }) => {
    test.setTimeout(60000);

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupPlayer(page1, "Leader1");
    await startSoloRun(page1, "fruits");
    await submitAnswer(page1, "apple");
    await expect(page1.getByText("answers (1)")).toBeVisible({ timeout: 2000 });
    await submitAnswer(page1, "banana");
    await expect(page1.getByText("answers (2)")).toBeVisible({ timeout: 2000 });
    await waitForResults(page1);

    await expect(page1.getByText("Leader1").first()).toBeVisible({
      timeout: 5000,
    });

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await setupPlayer(page2, "Leader2");
    await startSoloRun(page2, "fruits");
    await submitAnswer(page2, "mango");
    await expect(page2.getByText("answers (1)")).toBeVisible({ timeout: 2000 });
    await waitForResults(page2);

    // Both players in leaderboard
    await expect(page2.getByText("Leader1").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page2.getByText("Leader2").first()).toBeVisible({
      timeout: 5000,
    });

    await ctx1.close();
    await ctx2.close();
  });

  test("alias-based category merge into one leaderboard", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await setupPlayer(page1, "AliasP1");
    await startSoloRun(page1, "types of cheese");
    // "types of" prefix stripped → display "cheese", slug "cheese"
    await expect(page1.getByText("cheese")).toBeVisible({ timeout: 5000 });
    await submitAnswer(page1, "cheddar");
    await expect(page1.getByText("answers (1)")).toBeVisible({ timeout: 2000 });
    await waitForResults(page1);

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await setupPlayer(page2, "AliasP2");
    await startSoloRun(page2, "cheeses");
    // "cheeses" singularizes to slug "cheese" — same bucket
    await expect(page2.getByText("cheese")).toBeVisible({ timeout: 5000 });
    await submitAnswer(page2, "brie");
    await expect(page2.getByText("answers (1)")).toBeVisible({ timeout: 2000 });
    await waitForResults(page2);

    // Both players in merged leaderboard
    await expect(page2.getByText("AliasP1").first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page2.getByText("AliasP2").first()).toBeVisible({
      timeout: 5000,
    });

    await ctx1.close();
    await ctx2.close();
  });

  test("can finish a run early", async ({ page }) => {
    test.setTimeout(30000);
    await setupPlayer(page, "EarlyFinisher");
    await startSoloRun(page, "fruits");

    await submitAnswer(page, "apple");
    await expect(page.getByText("answers (1)")).toBeVisible({ timeout: 2000 });
    await submitAnswer(page, "banana");
    await expect(page.getByText("answers (2)")).toBeVisible({ timeout: 2000 });

    // Click finish early
    await page.getByRole("button", { name: "finish early" }).click();

    // Should show results without waiting for timer
    await expect(
      page.getByRole("heading", { name: "results" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("apple")).toBeVisible();
    await expect(page.getByText("banana")).toBeVisible();
  });

  test("category query param pre-fills the setup form", async ({ page }) => {
    await setupPlayer(page, "PreFillPlayer");
    await page.goto("/solo?category=animals");

    // Category input should be pre-filled
    await expect(
      page.getByPlaceholder("enter a category (e.g. fruits, countries)"),
    ).toHaveValue("animals", { timeout: 5000 });
  });

  test("leaderboards page is browsable", async ({ page }) => {
    await page.goto("/solo/leaderboards");
    await expect(
      page.getByRole("heading", { name: "leaderboards" }),
    ).toBeVisible({ timeout: 5000 });

    await expect(page.getByRole("button", { name: "10s", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "60s", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "start a solo run" }),
    ).toBeVisible();
  });
});
