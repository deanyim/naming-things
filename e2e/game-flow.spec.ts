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
    await hostPage.getByPlaceholder("category").fill("fruits");
    await hostPage.getByRole("button", { name: "start round" }).click();

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

    // The answer should appear in the host's answer list
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 5000 });

    // CRITICAL CHECK: After submitting an answer, the game should still be
    // in the playing state. The timer should NOT be 0:00 and the game should
    // NOT have transitioned to the review phase.
    //
    // Bug: useCountdown initializes secondsRemaining=0, so isExpired=true
    // on the first render. The host's PlayingRound component sees isExpired
    // and fires endAnswering immediately.

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
    await expect(playerPage.getByText("banana")).toBeVisible({ timeout: 5000 });

    // Game should STILL be in playing state
    await expect(
      hostPage.getByPlaceholder("type an answer"),
    ).toBeVisible();

    // Cleanup
    await hostContext.close();
    await playerContext.close();
  });
});
