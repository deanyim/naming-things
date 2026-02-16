import { test, expect, type Page } from "@playwright/test";

/**
 * Helper: set up a player session by entering a display name.
 * Returns the page ready to create or join a game.
 */
async function setupPlayer(page: Page, name: string) {
  await page.goto("/");
  await page.getByPlaceholder("your display name").fill(name);
}

/**
 * Helper: host creates a game and returns the game code.
 */
async function createGame(page: Page): Promise<string> {
  await page.getByRole("button", { name: "create game" }).click();
  // Wait for redirect to /game/[code]
  await page.waitForURL(/\/game\/[A-Z0-9]{6}$/);
  const url = page.url();
  const code = url.split("/game/")[1]!;
  return code;
}

/**
 * Helper: player joins a game by code.
 */
async function joinGame(page: Page, code: string) {
  await page.getByPlaceholder("enter game code").fill(code);
  await page.getByRole("button", { name: "join game" }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}$/);
}

/**
 * Helper: host sets topic and starts the round.
 */
async function setTopicAndStart(
  page: Page,
  topic: string,
  timerSeconds = 10,
) {
  await page.getByPlaceholder("topic").fill(topic);
  await page.getByRole("button", { name: "set" }).click();
  // Wait for topic to be confirmed in the lobby
  await expect(page.getByText(`topic: ${topic}`)).toBeVisible({
    timeout: 5000,
  });
  await page.locator("input[type=number]").fill(String(timerSeconds));
  await page.getByRole("button", { name: "start round" }).click();
}

test.describe("Game flow", () => {
  test("submitting an answer should NOT end the game early", async ({
    browser,
  }) => {
    // --- Host creates a game ---
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    // Verify we're in the lobby
    await expect(hostPage.getByText("lobby")).toBeVisible();
    await expect(hostPage.getByText(code)).toBeVisible();

    // --- Player joins ---
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);

    // Both should see each other in the lobby
    await expect(hostPage.getByText("Player")).toBeVisible();

    // --- Host starts the round ---
    await setTopicAndStart(hostPage, "fruits");

    // Wait for playing state - host should see the category and a timer
    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    // Timer should show a non-zero value (not 0:00)
    await expect(hostPage.locator("text=0:00")).not.toBeVisible({
      timeout: 2000,
    });

    // Player should also see the playing state
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // --- Host submits an answer ---
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // The answer should appear instantly in the host's answer list (local state)
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 1000 });

    // CRITICAL CHECK: After submitting an answer, the game should still be
    // in the playing state. The timer should NOT be 0:00 and the game should
    // NOT have transitioned to the review phase.

    // Wait a moment to let any erroneous state transition propagate
    await hostPage.waitForTimeout(3000);

    // The game should still be in playing mode - the answer input should still exist
    await expect(
      hostPage.getByPlaceholder("type an answer"),
    ).toBeVisible();

    // The review phase heading should NOT be visible
    await expect(hostPage.getByText("review answers")).not.toBeVisible();

    // Player should also still be in playing mode
    await expect(
      playerPage.getByPlaceholder("type an answer"),
    ).toBeVisible();

    // --- Player also submits an answer ---
    await playerPage.getByPlaceholder("type an answer").fill("banana");
    await playerPage.getByRole("button", { name: "add" }).click();
    await expect(playerPage.getByText("banana")).toBeVisible({ timeout: 1000 });

    // Game should STILL be in playing state
    await expect(
      hostPage.getByPlaceholder("type an answer"),
    ).toBeVisible();

    // Cleanup
    await hostContext.close();
    await playerContext.close();
  });

  test("answers appear instantly and survive page refresh", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    // Need a second player to have a valid game
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);

    // Start round
    await setTopicAndStart(hostPage, "animals");
    await expect(hostPage.getByText("animals")).toBeVisible({ timeout: 5000 });

    // Submit answers - should appear instantly (no server round-trip)
    await hostPage.getByPlaceholder("type an answer").fill("cat");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("cat")).toBeVisible({ timeout: 500 });

    await hostPage.getByPlaceholder("type an answer").fill("dog");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("dog")).toBeVisible({ timeout: 500 });

    // Verify answer count
    await expect(hostPage.getByText("your answers (2)")).toBeVisible();

    // Refresh page - answers should survive via localStorage
    await hostPage.reload();
    await expect(hostPage.getByText("animals")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("cat")).toBeVisible({ timeout: 3000 });
    await expect(hostPage.getByText("dog")).toBeVisible();
    await expect(hostPage.getByText("your answers (2)")).toBeVisible();

    // Cleanup
    await hostContext.close();
    await playerContext.close();
  });

  test("duplicate answers show error message", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);

    await setTopicAndStart(hostPage, "colors");
    await expect(hostPage.getByText("colors")).toBeVisible({ timeout: 5000 });

    // Submit an answer
    await hostPage.getByPlaceholder("type an answer").fill("red");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("red")).toBeVisible({ timeout: 500 });

    // Try to submit the same answer again
    await hostPage.getByPlaceholder("type an answer").fill("red");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Should show duplicate error
    await expect(
      hostPage.getByText("you already have that answer"),
    ).toBeVisible({ timeout: 1000 });

    // Should still only have 1 answer
    await expect(hostPage.getByText("your answers (1)")).toBeVisible();

    await hostContext.close();
    await playerContext.close();
  });

  test("no console errors during timer expiry and both players answers show in review", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();

    // Collect console errors
    const hostErrors: string[] = [];
    const playerErrors: string[] = [];
    hostPage.on("console", (msg) => {
      if (msg.type() === "error") hostErrors.push(msg.text());
    });
    playerPage.on("console", (msg) => {
      if (msg.type() === "error") playerErrors.push(msg.text());
    });

    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Player")).toBeVisible();

    // Start with 10s timer
    await setTopicAndStart(hostPage, "fruits");

    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Both submit answers
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 500 });

    await playerPage.getByPlaceholder("type an answer").fill("banana");
    await playerPage.getByRole("button", { name: "add" }).click();
    await expect(playerPage.getByText("banana")).toBeVisible({ timeout: 500 });

    // Both submit a common answer
    await hostPage.getByPlaceholder("type an answer").fill("orange");
    await hostPage.getByRole("button", { name: "add" }).click();
    await playerPage.getByPlaceholder("type an answer").fill("orange");
    await playerPage.getByRole("button", { name: "add" }).click();

    // Wait for timer to expire and game to transition to review
    await expect(hostPage.getByRole("heading", { name: "review answers" })).toBeVisible({
      timeout: 15000,
    });
    await expect(playerPage.getByRole("heading", { name: "review answers" })).toBeVisible({
      timeout: 10000,
    });

    // Both players' answers should appear in review phase
    // "apple" and "banana" are unique, "orange" is common
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("banana")).toBeVisible();

    // Filter out known benign errors (React hydration, etc)
    const isTrpcError = (msg: string) =>
      msg.includes("Time is up") ||
      msg.includes("not in playing state") ||
      msg.includes("not accepting answers") ||
      msg.includes("TRPCClientError");

    const hostTrpcErrors = hostErrors.filter(isTrpcError);
    const playerTrpcErrors = playerErrors.filter(isTrpcError);

    expect(hostTrpcErrors).toHaveLength(0);
    expect(playerTrpcErrors).toHaveLength(0);

    await hostContext.close();
    await playerContext.close();
  });

  test("final scoreboard shows expandable answers with common/disputed badges", async ({
    browser,
  }) => {
    test.setTimeout(90000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();

    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Player")).toBeVisible();

    // Start with 10s timer
    await setTopicAndStart(hostPage, "fruits");

    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Both submit a common answer
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();
    await playerPage.getByPlaceholder("type an answer").fill("apple");
    await playerPage.getByRole("button", { name: "add" }).click();

    // Each submits a unique answer
    await hostPage.getByPlaceholder("type an answer").fill("mango");
    await hostPage.getByRole("button", { name: "add" }).click();
    await playerPage.getByPlaceholder("type an answer").fill("banana");
    await playerPage.getByRole("button", { name: "add" }).click();

    // Wait for review phase
    await expect(
      hostPage.getByRole("heading", { name: "review answers" }),
    ).toBeVisible({ timeout: 15000 });

    // Wait for both players' answers to appear before finishing
    await expect(hostPage.getByText("banana")).toBeVisible({ timeout: 10000 });
    await expect(hostPage.getByText("mango")).toBeVisible({ timeout: 5000 });

    // Host finishes the game
    await hostPage.getByRole("button", { name: /finish/i }).click();

    // Wait for final scores
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 10000,
    });

    // Click on Host's row to expand
    const hostButton = hostPage.locator("button", { hasText: "Host" });
    await expect(hostButton).toBeVisible();
    await hostButton.click();

    // Should see Host's answers: "apple" (common) and "mango"
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("mango")).toBeVisible();

    // "apple" should have a "common" badge
    const appleRow = hostPage.locator("li", { hasText: "apple" });
    await expect(appleRow.getByText("common")).toBeVisible();

    // Collapse Host's row
    await hostButton.click();
    // "mango" should no longer be visible (it was only in Host's expanded list)
    await expect(hostPage.locator("li", { hasText: "mango" })).not.toBeVisible();

    // Expand Player's row
    const playerButton = hostPage.locator("button", { hasText: "Player" });
    await playerButton.click();

    // Should see Player's answers: "apple" (common) and "banana"
    await expect(
      hostPage.locator("li", { hasText: "banana" }),
    ).toBeVisible({ timeout: 3000 });
    const playerAppleRow = hostPage.locator("li", { hasText: "apple" });
    await expect(playerAppleRow.getByText("common")).toBeVisible();

    await hostContext.close();
    await playerContext.close();
  });
});
