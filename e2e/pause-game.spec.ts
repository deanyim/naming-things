import { test, expect, type Page } from "@playwright/test";

async function setupPlayer(page: Page, name: string) {
  await page.goto("/");
  await page.getByPlaceholder("your display name").fill(name);
}

async function createGame(page: Page): Promise<string> {
  await page.getByRole("button", { name: "create game" }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}$/);
  const url = page.url();
  return url.split("/game/")[1]!;
}

async function joinGame(page: Page, code: string) {
  await page.getByPlaceholder("enter game code").fill(code);
  await page.getByRole("button", { name: "join game" }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}$/);
}

async function setTopicAndStart(
  page: Page,
  topic: string,
  timerSeconds = 10,
) {
  await page.getByPlaceholder("e.g. types of cheese").fill(topic);
  await page.getByRole("button", { name: "set" }).first().click();
  await expect(page.getByText(`topic: ${topic}`)).toBeVisible({
    timeout: 5000,
  });
  await page.locator("select").selectOption("seconds");
  await page.locator("input[type=number]").fill(String(timerSeconds));
  await page.getByRole("button", { name: "set" }).nth(1).click();
  await expect(page.getByText(`timer: ${timerSeconds}s`)).toBeVisible({
    timeout: 5000,
  });
  await page.getByRole("button", { name: "start round" }).click();
}

async function selectTurnsMode(page: Page) {
  await page.getByRole("button", { name: "last one standing" }).click();
  await expect(
    page.getByRole("button", { name: "last one standing" }),
  ).toHaveClass(/bg-gray-900/, { timeout: 10000 });
}

async function setTopicAndStartTurns(
  page: Page,
  topic: string,
  turnTimerSeconds = 10,
) {
  await page.getByPlaceholder("e.g. types of cheese").fill(topic);
  await page.getByRole("button", { name: "set" }).first().click();
  await expect(page.getByText(`topic: ${topic}`)).toBeVisible({
    timeout: 5000,
  });
  await page.locator("input[type=number]").fill(String(turnTimerSeconds));
  const setBtn = page.getByRole("button", { name: "set" }).nth(1);
  if (await setBtn.isEnabled()) {
    await setBtn.click();
  }
  await expect(
    page.getByText(`turn timer: ${turnTimerSeconds}s`),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "start round" }).click();
}

test.describe("Pause game", () => {
  test("classic mode: host can pause and resume", async ({ browser }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    // Start with 30s timer (enough time to pause/resume)
    await setTopicAndStart(hostPage, "fruits", 30);
    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Host clicks pause
    await hostPage.getByRole("button", { name: "pause" }).click();

    // Both players see "game paused" overlay
    await expect(hostPage.getByText("game paused")).toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("game paused")).toBeVisible({ timeout: 5000 });

    // Player sees waiting message
    await expect(playerPage.getByText("waiting for host to resume...")).toBeVisible();

    // Host clicks resume
    await hostPage.getByRole("button", { name: "resume" }).click();

    // Overlay disappears
    await expect(hostPage.getByText("game paused")).not.toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("game paused")).not.toBeVisible({ timeout: 5000 });

    // Timer should still show time remaining (not 0:00)
    await expect(hostPage.locator("text=0:00")).not.toBeVisible({ timeout: 2000 });

    // Answer input should be re-enabled
    await expect(hostPage.getByPlaceholder("type an answer...")).toBeEnabled();

    await hostContext.close();
    await playerContext.close();
  });

  test("classic mode: host can terminate from pause menu", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 10000 });

    await setTopicAndStart(hostPage, "fruits", 30);
    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Both players type answers before pausing
    await hostPage.getByPlaceholder("type an answer...").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();
    await playerPage.getByPlaceholder("type an answer...").fill("banana");
    await playerPage.getByRole("button", { name: "add" }).click();

    // Host pauses
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(hostPage.getByText("game paused")).toBeVisible({ timeout: 5000 });

    // Host clicks "end game"
    await hostPage.getByRole("button", { name: "end game" }).click();

    // Confirmation appears — click "end game" again to confirm
    await hostPage.getByText("are you sure?").waitFor({ timeout: 3000 });
    // Click the red "end game" button in the confirmation
    await hostPage.locator("button.bg-red-600").click();

    // Both players see review phase (not final scores directly)
    await expect(hostPage.getByRole("heading", { name: "review answers" })).toBeVisible({
      timeout: 10000,
    });
    await expect(playerPage.getByRole("heading", { name: "review answers" })).toBeVisible({
      timeout: 10000,
    });

    // Answers should be visible in the review list
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("banana")).toBeVisible({ timeout: 5000 });

    // Host clicks "finish & score"
    await hostPage.getByRole("button", { name: "finish & score" }).click();

    // Both players see final scores
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 10000,
    });
    await expect(playerPage.getByText("final scores")).toBeVisible({
      timeout: 10000,
    });

    await hostContext.close();
    await playerContext.close();
  });

  test("classic mode: terminate goes to review and scores answers", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 10000 });

    await setTopicAndStart(hostPage, "fruits", 30);
    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Both players type answers
    await hostPage.getByPlaceholder("type an answer...").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();
    await playerPage.getByPlaceholder("type an answer...").fill("banana");
    await playerPage.getByRole("button", { name: "add" }).click();

    // Host pauses and terminates
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(hostPage.getByText("game paused")).toBeVisible({ timeout: 5000 });
    await hostPage.getByRole("button", { name: "end game" }).click();
    await hostPage.getByText("are you sure?").waitFor({ timeout: 3000 });
    await hostPage.locator("button.bg-red-600").click();

    // Both see review phase with answers
    await expect(hostPage.getByRole("heading", { name: "review answers" })).toBeVisible({ timeout: 10000 });
    await expect(playerPage.getByRole("heading", { name: "review answers" })).toBeVisible({ timeout: 10000 });
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("banana")).toBeVisible({ timeout: 5000 });

    // Host finishes scoring
    await hostPage.getByRole("button", { name: "finish & score" }).click();

    // Both see final scores with non-zero values
    await expect(hostPage.getByText("final scores")).toBeVisible({ timeout: 10000 });
    await expect(playerPage.getByText("final scores")).toBeVisible({ timeout: 10000 });

    // Each player scored 1 point for their unique answer
    // Score buttons show pattern like "1 Player 1 ▼" (rank, name, score, arrow)
    // Verify both players' scores appear (non-zero means they're listed with points)
    await expect(hostPage.getByRole("button", { name: /Host 1/ })).toBeVisible();
    await expect(hostPage.getByRole("button", { name: /Player 1/ })).toBeVisible();

    await hostContext.close();
    await playerContext.close();
  });

  test("turns mode: host can pause and resume", async ({ browser }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 10);

    // Wait for host's turn
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });

    // Host pauses
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(hostPage.getByText("game paused")).toBeVisible({ timeout: 5000 });
    await expect(playerPage.getByText("game paused")).toBeVisible({ timeout: 5000 });

    // Host resumes
    await hostPage.getByRole("button", { name: "resume" }).click();
    await expect(hostPage.getByText("game paused")).not.toBeVisible({ timeout: 5000 });

    // Same player should still have their turn
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });

    await hostContext.close();
    await playerContext.close();
  });

  test("turns mode: host can terminate from pause menu", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 10);

    // Host answers first to get some score
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.getByPlaceholder("type an answer...").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Player's turn — host pauses
    await expect(playerPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(hostPage.getByText("game paused")).toBeVisible({ timeout: 5000 });

    // Host terminates
    await hostPage.getByRole("button", { name: "end game" }).click();
    await hostPage.getByText("are you sure?").waitFor({ timeout: 3000 });
    await hostPage.locator("button.bg-red-600").click();

    // Both see final scores
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 5000,
    });
    await expect(playerPage.getByText("final scores")).toBeVisible({
      timeout: 5000,
    });

    // Host's score should reflect the 1 answer they submitted
    await expect(hostPage.getByText("1").first()).toBeVisible();

    await hostContext.close();
    await playerContext.close();
  });

  test("non-host cannot see resume or end game buttons", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    await setTopicAndStart(hostPage, "fruits", 30);
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Host pauses
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(playerPage.getByText("game paused")).toBeVisible({ timeout: 5000 });

    // Player sees waiting message, NOT buttons
    await expect(playerPage.getByText("waiting for host to resume...")).toBeVisible();
    await expect(
      playerPage.getByRole("button", { name: "resume" }),
    ).not.toBeVisible();
    await expect(
      playerPage.getByRole("button", { name: "end game" }),
    ).not.toBeVisible();

    await hostContext.close();
    await playerContext.close();
  });

  test("input disabled while paused in classic mode", async ({ browser }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    await setTopicAndStart(hostPage, "fruits", 30);
    await expect(playerPage.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Verify input is enabled before pause
    await expect(playerPage.getByPlaceholder("type an answer...")).toBeEnabled();

    // Host pauses
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(playerPage.getByText("game paused")).toBeVisible({ timeout: 5000 });

    // Input should be disabled while paused (behind the overlay, but still disabled)
    await expect(playerPage.getByPlaceholder("type an answer...")).toBeDisabled();

    // Host resumes
    await hostPage.getByRole("button", { name: "resume" }).click();
    await expect(playerPage.getByText("game paused")).not.toBeVisible({ timeout: 5000 });

    // Input should be re-enabled
    await expect(playerPage.getByPlaceholder("type an answer...")).toBeEnabled();

    await hostContext.close();
    await playerContext.close();
  });

  test("timer max increased to 120 minutes", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    await createGame(hostPage);

    // Set timer to 90 minutes (5400s) — beyond old 60 min limit
    await hostPage.getByPlaceholder("e.g. types of cheese").fill("fruits");
    await hostPage.getByRole("button", { name: "set" }).first().click();
    await expect(hostPage.getByText("topic: fruits")).toBeVisible({ timeout: 5000 });

    // Keep "minutes" unit (default) and set to 90
    await hostPage.locator("input[type=number]").fill("90");
    await hostPage.getByRole("button", { name: "set" }).nth(1).click();

    // Verify it saved — lobby shows "90 min"
    await expect(hostPage.getByText("timer: 90 min")).toBeVisible({
      timeout: 5000,
    });

    await hostContext.close();
  });
});
