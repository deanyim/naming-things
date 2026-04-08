import { test, expect, type Page } from "@playwright/test";

async function expectPlayerScore(page: Page, name: string, score: number) {
  const btn = page.getByRole("button", { name: new RegExp(name) });
  await expect(btn).toBeVisible({ timeout: 5000 });
  await expect(btn.locator("span.text-xl")).toHaveText(String(score), { timeout: 5000 });
}

async function setupPlayer(page: Page, name: string) {
  await page.goto("/");
  await page.getByPlaceholder("your display name").fill(name);
}

async function createGame(page: Page): Promise<string> {
  await page.getByRole("button", { name: "create game" }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}$/);
  const url = page.url();
  const code = url.split("/game/")[1]!;
  return code;
}

async function joinGame(page: Page, code: string) {
  await page.getByPlaceholder("enter game code").fill(code);
  await page.getByRole("button", { name: "join game" }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}$/);
}

async function enableAutoReviewAndStart(
  page: Page,
  topic: string,
  timerSeconds = 60,
) {
  // Enable auto review
  const section = autoReviewSection(page);
  const onBtn = section.getByRole("button", { name: "on" });
  await onBtn.click();
  await expect(onBtn).toHaveClass(/bg-gray-900/, { timeout: 5000 });

  // Set topic
  await page.getByPlaceholder("e.g. types of cheese").fill(topic);
  await page.getByRole("button", { name: "set" }).first().click();
  await expect(page.getByText(`topic: ${topic}`)).toBeVisible({ timeout: 5000 });

  // Set timer to seconds
  await page.locator("select").selectOption("seconds");
  await page.locator("input[type=number]").fill(String(timerSeconds));

  // Start
  await page.getByRole("button", { name: "start round" }).click();
}

async function pauseAndEndGame(page: Page) {
  await page.getByRole("button", { name: "pause" }).click();
  await expect(page.getByText("game paused")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "end game" }).click();
  await page.getByText("are you sure?").waitFor({ timeout: 3000 });
  await page.locator("button.bg-red-600").click();
}

function autoReviewSection(page: Page) {
  return page.locator("div").filter({ hasText: /^auto review/ });
}

test.describe("Auto review", () => {
  test("host can toggle auto review on/off in lobby", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await setupPlayer(page, "Host");
    await createGame(page);

    const section = autoReviewSection(page);
    const offBtn = section.getByRole("button", { name: "off" });
    const onBtn = section.getByRole("button", { name: "on" });

    // Default should be off (off button has active styling)
    await expect(offBtn).toHaveClass(/bg-gray-900/, { timeout: 5000 });

    // Toggle on
    await onBtn.click();
    await expect(onBtn).toHaveClass(/bg-gray-900/, { timeout: 5000 });

    // Toggle off
    await offBtn.click();
    await expect(offBtn).toHaveClass(/bg-gray-900/, { timeout: 5000 });

    await ctx.close();
  });

  test("non-host sees auto review state as read-only", async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const p2Ctx = await browser.newContext();
    const p2Page = await p2Ctx.newPage();
    await setupPlayer(p2Page, "Player2");
    await joinGame(p2Page, code);

    await expect(p2Page.getByText("auto review: off")).toBeVisible({
      timeout: 5000,
    });

    // Non-host should not have on/off toggle buttons for auto review
    const autoReviewButtons = p2Page
      .locator("div")
      .filter({ hasText: /^auto review/ })
      .getByRole("button");
    await expect(autoReviewButtons).toHaveCount(0);

    await hostCtx.close();
    await p2Ctx.close();
  });

  test("auto-classification marks invalid answers as rejected in review", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Ctx = await browser.newContext();
    const p2Page = await p2Ctx.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({
      timeout: 5000,
    });

    await enableAutoReviewAndStart(hostPage, "fruits");

    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Alice submits a valid answer
    await hostPage.getByPlaceholder("type an answer").fill("banana");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("banana")).toBeVisible({ timeout: 3000 });

    // Bob submits an invalid answer (contains "zzinvalid" for mock)
    await p2Page.getByPlaceholder("type an answer").fill("zzinvalid");
    await p2Page.getByRole("button", { name: "add" }).click();
    await expect(p2Page.getByText("zzinvalid")).toBeVisible({ timeout: 3000 });

    // End the game via pause
    await pauseAndEndGame(hostPage);

    // Both should see review phase
    await expect(
      hostPage.getByRole("heading", { name: "review answers" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      p2Page.getByRole("heading", { name: "review answers" }),
    ).toBeVisible({ timeout: 10000 });

    // Wait for classification to complete, then expand auto-classified section
    await expect(hostPage.getByText("auto-classified")).toBeVisible({ timeout: 15000 });
    await hostPage.getByText("auto-classified").click();
    await expect(hostPage.getByText("banana")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("zzinvalid")).toBeVisible({ timeout: 5000 });

    // zzinvalid should show as rejected
    await expect(hostPage.getByText("rejected")).toBeVisible();

    // Host finishes scoring
    await hostPage.getByRole("button", { name: "finish & score" }).click();
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 5000,
    });

    // Alice should have 1 point (banana accepted), Bob should have 0 (zzinvalid rejected)
    await expectPlayerScore(hostPage, "Alice", 1);
    await expectPlayerScore(hostPage, "Bob", 0);

    await hostCtx.close();
    await p2Ctx.close();
  });

  test("player can dispute an auto-rejected answer and override via vote", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Ctx = await browser.newContext();
    const p2Page = await p2Ctx.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({
      timeout: 5000,
    });

    await enableAutoReviewAndStart(hostPage, "fruits");

    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Alice submits a valid answer
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Bob submits an answer that mock will reject
    await p2Page.getByPlaceholder("type an answer").fill("zzinvalid cherry");
    await p2Page.getByRole("button", { name: "add" }).click();

    await pauseAndEndGame(hostPage);

    await expect(
      hostPage.getByRole("heading", { name: "review answers" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      p2Page.getByRole("heading", { name: "review answers" }),
    ).toBeVisible({ timeout: 10000 });

    // Expand auto-classified section to find the rejected answer
    await expect(hostPage.getByText("auto-classified")).toBeVisible({ timeout: 10000 });
    await hostPage.getByText("auto-classified").click();

    // Alice disputes Bob's rejected answer to accept it
    const rejectedCard = hostPage.locator("div.rounded-lg.border").filter({ hasText: /zzinvalid cherry/ });
    await rejectedCard.getByRole("button", { name: "dispute" }).click();

    // Should show as disputed with voting buttons
    await expect(hostPage.getByText("disputed")).toBeVisible({ timeout: 5000 });

    // Alice votes to accept
    await hostPage.getByRole("button", { name: /accept/ }).click();
    await expect(
      hostPage.getByRole("button", { name: /accept \(1\)/ }),
    ).toBeVisible({ timeout: 5000 });

    // Finish scoring — disputed answer with 1 accept > 0 reject → accepted
    await hostPage.getByRole("button", { name: "finish & score" }).click();
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 5000,
    });

    // Both players should have 1 point each
    await expectPlayerScore(hostPage, "Alice", 1);
    await expectPlayerScore(hostPage, "Bob", 1);

    await hostCtx.close();
    await p2Ctx.close();
  });

  test("player can dispute an auto-accepted answer and reject via vote", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Ctx = await browser.newContext();
    const p2Page = await p2Ctx.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({
      timeout: 5000,
    });

    await enableAutoReviewAndStart(hostPage, "fruits");

    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Bob submits an answer the mock will accept (no zzinvalid)
    await p2Page.getByPlaceholder("type an answer").fill("pizza");
    await p2Page.getByRole("button", { name: "add" }).click();

    // Alice submits a valid answer
    await hostPage.getByPlaceholder("type an answer").fill("banana");
    await hostPage.getByRole("button", { name: "add" }).click();

    await pauseAndEndGame(hostPage);

    await expect(
      hostPage.getByRole("heading", { name: "review answers" }),
    ).toBeVisible({ timeout: 10000 });

    // Expand auto-classified section to find pizza
    await expect(hostPage.getByText("auto-classified")).toBeVisible({ timeout: 10000 });
    await hostPage.getByText("auto-classified").click();

    // Alice disputes Bob's "pizza" (auto-accepted but doesn't fit "fruits")
    const pizzaCard = hostPage.locator("div.rounded-lg.border").filter({ hasText: /^pizza/ });
    await pizzaCard.getByRole("button", { name: "dispute" }).click();
    await expect(hostPage.getByText("disputed")).toBeVisible({ timeout: 5000 });

    // Alice votes to reject
    await hostPage.getByRole("button", { name: /reject/ }).click();
    await expect(
      hostPage.getByRole("button", { name: /reject \(1\)/ }),
    ).toBeVisible({ timeout: 5000 });

    // Finish scoring
    await hostPage.getByRole("button", { name: "finish & score" }).click();
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 5000,
    });

    // Alice should have 1 (banana), Bob should have 0 (pizza rejected via dispute)
    await expectPlayerScore(hostPage, "Alice", 1);
    await expectPlayerScore(hostPage, "Bob", 0);

    await hostCtx.close();
    await p2Ctx.close();
  });

  test("auto review off: all answers arrive unclassified and are accepted by default", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostCtx = await browser.newContext();
    const hostPage = await hostCtx.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Ctx = await browser.newContext();
    const p2Page = await p2Ctx.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({
      timeout: 5000,
    });

    // Do NOT enable auto review — leave it off (off button should be active)
    const offBtn = autoReviewSection(hostPage).getByRole("button", { name: "off" });
    await expect(offBtn).toHaveClass(/bg-gray-900/, { timeout: 5000 });

    // Set topic and start (without enabling auto review)
    await hostPage.getByPlaceholder("e.g. types of cheese").fill("fruits");
    await hostPage.getByRole("button", { name: "set" }).first().click();
    await expect(hostPage.getByText("topic: fruits")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.locator("select").selectOption("seconds");
    await hostPage.locator("input[type=number]").fill("60");
    await hostPage.getByRole("button", { name: "start round" }).click();

    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Both submit answers (including one with zzinvalid which would be rejected if auto review was on)
    await hostPage.getByPlaceholder("type an answer").fill("banana");
    await hostPage.getByRole("button", { name: "add" }).click();

    await p2Page.getByPlaceholder("type an answer").fill("zzinvalid");
    await p2Page.getByRole("button", { name: "add" }).click();

    await pauseAndEndGame(hostPage);

    await expect(
      hostPage.getByRole("heading", { name: "review answers" }),
    ).toBeVisible({ timeout: 10000 });

    // Finish scoring — both should be accepted since auto review is off
    await hostPage.getByRole("button", { name: "finish & score" }).click();
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 5000,
    });

    // Both players should have 1 point (no auto-classification happened)
    await expectPlayerScore(hostPage, "Alice", 1);
    await expectPlayerScore(hostPage, "Bob", 1);

    await hostCtx.close();
    await p2Ctx.close();
  });
});
