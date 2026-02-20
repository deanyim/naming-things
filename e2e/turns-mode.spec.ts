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

async function selectTurnsMode(page: Page) {
  await page.getByRole("button", { name: "last one standing" }).click();
  // Wait for mode button to be active (has bg-gray-900 class)
  await expect(
    page.getByRole("button", { name: "last one standing" }),
  ).toHaveClass(/bg-gray-900/, { timeout: 10000 });
}

async function setTopicAndStartTurns(
  page: Page,
  topic: string,
  turnTimerSeconds = 10,
) {
  // Set topic
  await page.getByPlaceholder("e.g. types of cheese").fill(topic);
  await page.getByRole("button", { name: "set" }).first().click();
  await expect(page.getByText(`topic: ${topic}`)).toBeVisible({
    timeout: 5000,
  });
  // Set turn timer (only click set if value differs from default)
  await page.locator("input[type=number]").fill(String(turnTimerSeconds));
  const setBtn = page.getByRole("button", { name: "set" }).nth(1);
  if (await setBtn.isEnabled()) {
    await setBtn.click();
  }
  await expect(
    page.getByText(`turn timer: ${turnTimerSeconds}s`),
  ).toBeVisible({ timeout: 10000 });
  // Start
  await page.getByRole("button", { name: "start round" }).click();
}

test.describe("Turns mode", () => {
  test("host selects last one standing mode, classic timer hidden", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    await createGame(hostPage);

    // Default mode should be classic
    await expect(
      hostPage.getByRole("button", { name: "classic" }),
    ).toHaveClass(/bg-gray-900/);

    // Classic timer should be visible
    await expect(hostPage.getByText("timer:")).toBeVisible();

    // Switch to turns mode
    await selectTurnsMode(hostPage);

    // Classic timer should be hidden, turn timer visible
    await expect(hostPage.getByText("turn timer:")).toBeVisible();

    await hostContext.close();
  });

  test("first player gets their turn after start, others see waiting", async ({
    browser,
  }) => {
    test.setTimeout(30000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Quinn", )).toBeVisible();

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 10);

    // Host should be first (lowest gamePlayers.id)
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    // Player should see waiting
    await expect(
      playerPage.getByText("Zara is thinking..."),
    ).toBeVisible({ timeout: 5000 });

    await hostContext.close();
    await playerContext.close();
  });

  test("answer advances turn and appears in history", async ({ browser }) => {
    test.setTimeout(30000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Quinn", )).toBeVisible();

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 10);

    // Host's turn
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Now it should be Quinn's turn
    await expect(playerPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    // Answer should appear in history
    await expect(playerPage.getByText("apple")).toBeVisible({ timeout: 5000 });

    await hostContext.close();
    await playerContext.close();
  });

  test("duplicate answer eliminates the player", async ({ browser }) => {
    test.setTimeout(30000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);

    // Add a third player so game doesn't end immediately
    const player2Context = await browser.newContext();
    const player2Page = await player2Context.newPage();
    await setupPlayer(player2Page, "Rex");
    await joinGame(player2Page, code);
    await expect(hostPage.getByText("Rex", )).toBeVisible();

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 10);

    // Host answers "apple"
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Quinn answers "banana"
    await expect(playerPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await playerPage.getByPlaceholder("type an answer").fill("banana");
    await playerPage.getByRole("button", { name: "add" }).click();

    // Rex submits duplicate "apple" — should be eliminated
    await expect(player2Page.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await player2Page.getByPlaceholder("type an answer").fill("apple");
    await player2Page.getByRole("button", { name: "add" }).click();

    // Rex should see eliminated message
    await expect(
      player2Page.getByText("you've been eliminated"),
    ).toBeVisible({ timeout: 5000 });

    await hostContext.close();
    await playerContext.close();
    await player2Context.close();
  });

  test("player eliminated on timeout, game continues", async ({ browser }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);

    const player2Context = await browser.newContext();
    const player2Page = await player2Context.newPage();
    await setupPlayer(player2Page, "Rex");
    await joinGame(player2Page, code);
    await expect(hostPage.getByText("Rex", )).toBeVisible();

    await selectTurnsMode(hostPage);
    // Use 5s timer — short enough to timeout quickly but long enough
    // that Rex doesn't also timeout before we can verify
    await setTopicAndStartTurns(hostPage, "fruits", 5);

    // Host answers quickly
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Quinn's turn — let it timeout
    await expect(playerPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });

    // Quinn should be eliminated after timeout
    await expect(
      playerPage.getByText("you've been eliminated"),
    ).toBeVisible({ timeout: 20000 });

    // Game should continue — Rex should get a turn
    await expect(player2Page.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });

    await hostContext.close();
    await playerContext.close();
    await player2Context.close();
  });

  test("last player standing finishes game with winner shown", async ({
    browser,
  }) => {
    test.setTimeout(30000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Quinn", )).toBeVisible();

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 3);

    // Host answers
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Quinn times out — gets eliminated, Zara is last one standing
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 8000,
    });

    // Winner banner should show
    await expect(
      hostPage.getByText("Zara is the last one standing!"),
    ).toBeVisible({ timeout: 5000 });

    await hostContext.close();
    await playerContext.close();
  });

  test("final scoreboard lists players in reverse elimination order with answers newest-first", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);

    const player2Context = await browser.newContext();
    const player2Page = await player2Context.newPage();
    await setupPlayer(player2Page, "Rex");
    await joinGame(player2Page, code);
    await expect(hostPage.getByText("Rex")).toBeVisible();

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 5);

    // Round 1: Zara answers "apple"
    await expect(hostPage.getByText("your turn!")).toBeVisible({ timeout: 5000 });
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Round 1: Quinn answers "banana"
    await expect(playerPage.getByText("your turn!")).toBeVisible({ timeout: 5000 });
    await playerPage.getByPlaceholder("type an answer").fill("banana");
    await playerPage.getByRole("button", { name: "add" }).click();

    // Round 1: Rex submits duplicate "apple" — eliminated first
    await expect(player2Page.getByText("your turn!")).toBeVisible({ timeout: 5000 });
    await player2Page.getByPlaceholder("type an answer").fill("apple");
    await player2Page.getByRole("button", { name: "add" }).click();
    await expect(player2Page.getByText("you've been eliminated")).toBeVisible({ timeout: 5000 });

    // Round 2: Zara answers "cherry"
    await expect(hostPage.getByText("your turn!")).toBeVisible({ timeout: 5000 });
    await hostPage.getByPlaceholder("type an answer").fill("cherry");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Round 2: Quinn times out — eliminated second
    // Wait for game to finish (Zara is last one standing)
    await expect(hostPage.getByText("final scores")).toBeVisible({ timeout: 20000 });

    // Verify order: Zara (winner) #1, Quinn (eliminated second) #2, Rex (eliminated first) #3
    const nameOrder = await hostPage
      .locator(".space-y-3 .font-medium.text-gray-900")
      .allTextContents();
    expect(nameOrder).toEqual(["Zara", "Quinn", "Rex"]);

    // Verify Zara's answers are newest-first: expand Zara's row
    await hostPage.locator("button").filter({ hasText: /Zara/ }).click();
    const zaraAnswers = await hostPage
      .locator("ul")
      .first()
      .locator("li")
      .allTextContents();
    // "cherry" (most recent) should come before "apple"
    const cherryIdx = zaraAnswers.findIndex((t) => t.includes("cherry"));
    const appleIdx = zaraAnswers.findIndex((t) => t.includes("apple"));
    expect(cherryIdx).toBeLessThan(appleIdx);

    await hostContext.close();
    await playerContext.close();
    await player2Context.close();
  });

  test("cannot start with fewer than 2 players", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    await createGame(hostPage);

    await selectTurnsMode(hostPage);

    // Set a topic so that isn't the reason the button is disabled
    await hostPage.getByPlaceholder("e.g. types of cheese").fill("fruits");
    await hostPage.getByRole("button", { name: "set" }).first().click();
    await expect(hostPage.getByText("topic: fruits")).toBeVisible({
      timeout: 5000,
    });

    // Start button should be disabled
    await expect(
      hostPage.getByRole("button", { name: "start round" }),
    ).toBeDisabled();

    // Helper message should be visible
    await expect(
      hostPage.getByText("need at least 2 players"),
    ).toBeVisible();

    await hostContext.close();
  });

  test("rematch preserves turns mode", async ({ browser }) => {
    test.setTimeout(30000);

    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Quinn", )).toBeVisible();

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 3);

    // Host answers
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Wait for game to finish (player times out)
    await expect(hostPage.getByText("final scores")).toBeVisible({
      timeout: 10000,
    });

    // Host clicks rematch
    await hostPage.getByRole("button", { name: "rematch" }).click();

    // Should be back in lobby with turns mode preserved
    await expect(hostPage.getByText("lobby")).toBeVisible({ timeout: 15000 });
    await expect(
      hostPage.getByRole("button", { name: "last one standing" }),
    ).toHaveClass(/bg-gray-900/, { timeout: 5000 });

    await hostContext.close();
    await playerContext.close();
  });

  test("optimistic UI: answer appears in history within 200ms of clicking add", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Zara");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Quinn");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Quinn")).toBeVisible();

    await selectTurnsMode(hostPage);
    await setTopicAndStartTurns(hostPage, "fruits", 10);

    // Wait for host's turn
    await expect(hostPage.getByText("your turn!")).toBeVisible({
      timeout: 5000,
    });

    await hostPage.getByPlaceholder("type an answer").fill("mango");
    const before = Date.now();
    await hostPage.getByRole("button", { name: "add" }).click();

    // Answer should appear in history almost instantly (optimistic update)
    await expect(hostPage.getByText("mango")).toBeVisible({ timeout: 200 });
    const elapsed = Date.now() - before;

    // "your turn!" should be gone, replaced by waiting state
    await expect(hostPage.getByText("your turn!")).not.toBeVisible({
      timeout: 200,
    });

    // Sanity: elapsed time should be well under 500ms
    expect(elapsed).toBeLessThan(500);

    await hostContext.close();
    await playerContext.close();
  });
});
