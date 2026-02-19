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

test.describe("Kick player", () => {
  test("host can kick a player from lobby", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);
    await expect(hostPage.getByText("lobby")).toBeVisible();

    // Player joins
    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Kicked");
    await joinGame(playerPage, code);

    // Host sees the player
    await expect(hostPage.getByText("players (2)")).toBeVisible({
      timeout: 5000,
    });
    await expect(hostPage.getByText("Kicked")).toBeVisible();

    // Host kicks the player
    await hostPage.getByRole("button", { name: "Kick Kicked" }).click();

    // Player disappears from host's players list
    await expect(hostPage.getByText("players (1)")).toBeVisible({
      timeout: 5000,
    });

    await hostContext.close();
    await playerContext.close();
  });

  test("non-host does not see kick buttons", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    const code = await createGame(hostPage);

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await setupPlayer(playerPage, "Player");
    await joinGame(playerPage, code);

    // Wait for player to see both players in the list
    await expect(playerPage.getByText("players (2)")).toBeVisible({
      timeout: 5000,
    });

    // Non-host should not see any kick buttons
    await expect(
      playerPage.getByRole("button", { name: /Kick/ }),
    ).not.toBeVisible();

    await hostContext.close();
    await playerContext.close();
  });
});
