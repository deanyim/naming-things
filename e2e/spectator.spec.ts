import { test, expect, type Page } from "@playwright/test";

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

test.describe("Spectator mode", () => {
  test("auto-spectate on visit — spectator appears in spectators list", async ({
    browser,
  }) => {
    // Host creates a game
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);
    await expect(hostPage.getByText("lobby")).toBeVisible();

    // Spectator navigates directly to game URL (new context = no session)
    const spectatorContext = await browser.newContext();
    const spectatorPage = await spectatorContext.newPage();
    // Navigate directly to the game page — no name set yet
    await spectatorPage.goto(`/game/${code}`);

    // Should see name prompt
    await expect(
      spectatorPage.getByText("enter your name to watch this game"),
    ).toBeVisible({ timeout: 5000 });

    // Enter name and continue
    await spectatorPage.getByPlaceholder("your display name").fill("Watcher");
    await spectatorPage.getByRole("button", { name: "continue" }).click();

    // Should now see the lobby as a spectator
    await expect(spectatorPage.getByText("you are spectating")).toBeVisible({
      timeout: 5000,
    });

    // Host should see spectator in the list
    await expect(hostPage.getByText("spectating (1)")).toBeVisible({
      timeout: 5000,
    });
    await expect(hostPage.getByText("Watcher")).toBeVisible();

    await hostContext.close();
    await spectatorContext.close();
  });

  test("spectator sees read-only view during play — no answer input", async ({
    browser,
  }) => {
    // Host creates game
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    // Player joins
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);
    await expect(hostPage.getByText("Player")).toBeVisible();

    // Spectator joins directly
    const spectatorContext = await browser.newContext();
    const spectatorPage = await spectatorContext.newPage();
    await spectatorPage.goto(`/game/${code}`);
    await spectatorPage.getByPlaceholder("your display name").fill("Watcher");
    await spectatorPage.getByRole("button", { name: "continue" }).click();
    await expect(spectatorPage.getByText("you are spectating")).toBeVisible({
      timeout: 5000,
    });

    // Host starts round
    await hostPage.getByPlaceholder("category").fill("animals");
    await hostPage.getByRole("button", { name: "start round" }).click();
    await expect(hostPage.getByText("animals")).toBeVisible({ timeout: 5000 });

    // Spectator should see the category and timer but NO answer input
    await expect(spectatorPage.getByText("animals")).toBeVisible({
      timeout: 5000,
    });
    await expect(
      spectatorPage.getByText("you are spectating — answers are hidden until review"),
    ).toBeVisible();
    await expect(
      spectatorPage.getByPlaceholder("type an answer"),
    ).not.toBeVisible();

    // Player CAN see the answer input
    await expect(playerPage.getByText("animals")).toBeVisible({ timeout: 5000 });
    await expect(
      playerPage.getByPlaceholder("type an answer"),
    ).toBeVisible();

    await hostContext.close();
    await playerContext.close();
    await spectatorContext.close();
  });

  test("spectator can upgrade to player via 'join as player' button", async ({
    browser,
  }) => {
    // Host creates game
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    // Spectator visits directly
    const spectatorContext = await browser.newContext();
    const spectatorPage = await spectatorContext.newPage();
    await spectatorPage.goto(`/game/${code}`);
    await spectatorPage.getByPlaceholder("your display name").fill("Upgrader");
    await spectatorPage.getByRole("button", { name: "continue" }).click();

    // Should be spectating
    await expect(spectatorPage.getByText("you are spectating")).toBeVisible({
      timeout: 5000,
    });
    await expect(hostPage.getByText("spectating (1)")).toBeVisible({
      timeout: 5000,
    });

    // Click "join as player"
    await spectatorPage
      .getByRole("button", { name: "join as player" })
      .click();

    // Should now appear in the players list (not spectators)
    await expect(spectatorPage.getByText("you are spectating")).not.toBeVisible(
      { timeout: 5000 },
    );
    await expect(
      spectatorPage.getByText("waiting for the host to start..."),
    ).toBeVisible();

    // Host should see the upgraded player in the players list
    await expect(hostPage.getByText("players (2)")).toBeVisible({
      timeout: 5000,
    });
    await expect(hostPage.getByText("Upgrader")).toBeVisible();

    await hostContext.close();
    await spectatorContext.close();
  });
});
