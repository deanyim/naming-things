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

/**
 * Helper: set topic, timer, and start for team mode games.
 * Uses last() for the timer select to avoid team selector ambiguity.
 */
async function setTopicTimerAndStart(
  page: Page,
  topic: string,
  timerSeconds: number,
) {
  await page.getByPlaceholder("e.g. types of cheese").fill(topic);
  await page.getByRole("button", { name: "set" }).first().click();
  await expect(page.getByText(`topic: ${topic}`)).toBeVisible({ timeout: 5000 });

  // Use last select (the timer unit selector) to avoid team selector conflict
  await page.locator("select").last().selectOption("seconds");
  // Use last number input (timer value) — first might be # teams
  await page.locator("input[type=number]").last().fill(String(timerSeconds));
  // Wait a tick for the value to register, then just start directly
  // (start handler auto-saves timer if changed)

  await page.getByRole("button", { name: "start round" }).click();
}

test.describe("Team mode", () => {
  test("host can toggle team mode on/off and set number of teams", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    await createGame(hostPage);
    await expect(hostPage.getByText("lobby")).toBeVisible();

    // Team mode toggle should be visible in classic mode
    await expect(hostPage.getByText("teams")).toBeVisible();

    // Toggle team mode on
    await hostPage.getByRole("button", { name: "on", exact: true }).click();

    // Number of teams input should appear
    await expect(hostPage.getByText("# teams")).toBeVisible({ timeout: 5000 });

    // Team groups should appear
    await expect(hostPage.getByText("team 1")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("team 2")).toBeVisible();

    // Toggle team mode off
    await hostPage.getByRole("button", { name: "off" }).click();

    // Team groups should disappear, standard player list shows
    await expect(hostPage.getByText("# teams")).not.toBeVisible({ timeout: 5000 });

    await hostContext.close();
  });

  test("players auto-assigned to teams round-robin when team mode enabled", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Context = await browser.newContext();
    const p2Page = await p2Context.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    // Enable team mode
    await hostPage.getByRole("button", { name: "on", exact: true }).click();

    // Players should be auto-assigned: Alice->Team 1, Bob->Team 2
    await expect(hostPage.getByText("team 1 (1)")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("team 2 (1)")).toBeVisible();

    await hostContext.close();
    await p2Context.close();
  });

  test("team mode game: shared answers appear for teammates in real-time", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Context = await browser.newContext();
    const p2Page = await p2Context.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    // Enable team mode with 1 team (cooperative)
    await hostPage.getByRole("button", { name: "on", exact: true }).click();
    await expect(hostPage.getByText("# teams")).toBeVisible({ timeout: 5000 });
    // Change to 1 team
    await hostPage.locator('input[type="number"]').first().fill("1");
    // Wait for reassignment
    await expect(hostPage.getByText("team 1 (2)")).toBeVisible({ timeout: 5000 });

    await setTopicTimerAndStart(hostPage, "fruits", 60);

    // Both players should see the playing state
    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Both should see "team 1:" teammate header
    await expect(hostPage.getByText(/team 1:/)).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByText(/team 1:/)).toBeVisible({ timeout: 5000 });

    // Host submits an answer
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Answer should appear for host
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 3000 });

    // Answer should also appear for teammate (Bob) via polling
    await expect(p2Page.getByText("apple")).toBeVisible({ timeout: 10000 });

    // Bob submits an answer
    await p2Page.getByPlaceholder("type an answer").fill("banana");
    await p2Page.getByRole("button", { name: "add" }).click();

    // Both should see banana
    await expect(p2Page.getByText("banana")).toBeVisible({ timeout: 3000 });
    await expect(hostPage.getByText("banana")).toBeVisible({ timeout: 10000 });

    // Should show "team answers (2)"
    await expect(hostPage.getByText("team answers (2)")).toBeVisible({ timeout: 10000 });

    await hostContext.close();
    await p2Context.close();
  });

  test("team mode: duplicate answer within same team is rejected", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Context = await browser.newContext();
    const p2Page = await p2Context.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    // Enable team mode with 1 team
    await hostPage.getByRole("button", { name: "on", exact: true }).click();
    await expect(hostPage.getByText("# teams")).toBeVisible({ timeout: 5000 });
    await hostPage.locator('input[type="number"]').first().fill("1");
    await expect(hostPage.getByText("team 1 (2)")).toBeVisible({ timeout: 5000 });

    await setTopicTimerAndStart(hostPage, "fruits", 60);

    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Host submits "apple"
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 3000 });

    // Wait for Bob to see it
    await expect(p2Page.getByText("apple")).toBeVisible({ timeout: 10000 });

    // Bob tries to submit "apple" (duplicate)
    await p2Page.getByPlaceholder("type an answer").fill("apple");
    await p2Page.getByRole("button", { name: "add" }).click();

    // Should show duplicate error
    await expect(p2Page.getByText("your team already has that answer")).toBeVisible({ timeout: 5000 });

    await hostContext.close();
    await p2Context.close();
  });

  test("team mode: teammate can remove an answer", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Context = await browser.newContext();
    const p2Page = await p2Context.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    // Enable team mode with 1 team
    await hostPage.getByRole("button", { name: "on", exact: true }).click();
    await expect(hostPage.getByText("# teams")).toBeVisible({ timeout: 5000 });
    await hostPage.locator('input[type="number"]').first().fill("1");
    await expect(hostPage.getByText("team 1 (2)")).toBeVisible({ timeout: 5000 });

    await setTopicTimerAndStart(hostPage, "fruits", 60);

    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Host submits "apple"
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 3000 });

    // Wait for Bob to see it
    await expect(p2Page.getByText("apple")).toBeVisible({ timeout: 10000 });

    // Bob removes it by clicking the pill
    await p2Page.getByRole("button", { name: /apple/ }).click();

    // Apple should disappear from Bob's view
    await expect(p2Page.getByText("apple")).not.toBeVisible({ timeout: 5000 });

    // And from host's view too (after polling)
    await expect(hostPage.getByText("apple")).not.toBeVisible({ timeout: 10000 });

    await hostContext.close();
    await p2Context.close();
  });

  test("team mode: review phase and scoring work correctly", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Context = await browser.newContext();
    const p2Page = await p2Context.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    // Enable team mode with 2 teams
    await hostPage.getByRole("button", { name: "on", exact: true }).click();
    await expect(hostPage.getByText("team 1 (1)")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("team 2 (1)")).toBeVisible();

    await setTopicTimerAndStart(hostPage, "fruits", 60);

    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByText("fruits")).toBeVisible({ timeout: 5000 });

    // Alice (team 1) submits answers
    await hostPage.getByPlaceholder("type an answer").fill("apple");
    await hostPage.getByRole("button", { name: "add" }).click();
    await expect(hostPage.getByText("apple")).toBeVisible({ timeout: 3000 });

    await hostPage.getByPlaceholder("type an answer").fill("banana");
    await hostPage.getByRole("button", { name: "add" }).click();

    // Bob (team 2) submits answers — including "apple" (should be common across teams)
    await p2Page.getByPlaceholder("type an answer").fill("apple");
    await p2Page.getByRole("button", { name: "add" }).click();
    await expect(p2Page.getByText("apple")).toBeVisible({ timeout: 3000 });

    await p2Page.getByPlaceholder("type an answer").fill("cherry");
    await p2Page.getByRole("button", { name: "add" }).click();

    // Host pauses and terminates to go to review (instead of waiting for timer)
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(hostPage.getByText("game paused")).toBeVisible({ timeout: 5000 });
    await hostPage.getByRole("button", { name: "end game" }).click();
    await hostPage.getByText("are you sure?").waitFor({ timeout: 3000 });
    await hostPage.locator("button.bg-red-600").click();

    // Both should see review phase
    await expect(hostPage.getByRole("heading", { name: "review answers" })).toBeVisible({ timeout: 5000 });
    await expect(p2Page.getByRole("heading", { name: "review answers" })).toBeVisible({ timeout: 10000 });

    // "apple" should be in the shared across teams (auto-accepted) section
    await expect(hostPage.getByText("shared across teams")).toBeVisible({ timeout: 5000 });

    // Finish and check scoreboard
    await hostPage.getByRole("button", { name: "finish & score" }).click();
    await expect(hostPage.getByText("final scores")).toBeVisible({ timeout: 5000 });

    // Should show team-based scoreboard
    await expect(hostPage.getByText("team 1 wins!")).toBeVisible();
    await expect(hostPage.getByRole("button", { name: /team 2/ })).toBeVisible();

    // Expand team 1 to see per-player contribution counts
    await hostPage.getByRole("button", { name: /team 1/ }).click();
    // Alice submitted 2 answers (apple, banana)
    await expect(hostPage.getByText("Alice (2)")).toBeVisible({ timeout: 5000 });

    // Expand team 2 to see Bob's contribution count
    await hostPage.getByRole("button", { name: /team 2/ }).click();
    // Bob submitted 2 answers (apple, cherry)
    await expect(hostPage.getByText("Bob (2)")).toBeVisible({ timeout: 5000 });

    await hostContext.close();
    await p2Context.close();
  });

  test("team mode: rematch preserves team settings", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Alice");
    const code = await createGame(hostPage);

    const p2Context = await browser.newContext();
    const p2Page = await p2Context.newPage();
    await setupPlayer(p2Page, "Bob");
    await joinGame(p2Page, code);

    await expect(hostPage.getByText("players (2)")).toBeVisible({ timeout: 5000 });

    // Enable team mode
    await hostPage.getByRole("button", { name: "on", exact: true }).click();
    await expect(hostPage.getByText("team 1 (1)")).toBeVisible({ timeout: 5000 });

    await setTopicTimerAndStart(hostPage, "fruits", 60);

    // Host pauses and terminates to go to review
    await expect(hostPage.getByText("fruits")).toBeVisible({ timeout: 5000 });
    await hostPage.getByRole("button", { name: "pause" }).click();
    await expect(hostPage.getByText("game paused")).toBeVisible({ timeout: 5000 });
    await hostPage.getByRole("button", { name: "end game" }).click();
    await hostPage.getByText("are you sure?").waitFor({ timeout: 3000 });
    await hostPage.locator("button.bg-red-600").click();
    await expect(hostPage.getByRole("heading", { name: "review answers" })).toBeVisible({ timeout: 5000 });

    // Finish
    await hostPage.getByRole("button", { name: "finish & score" }).click();
    await expect(hostPage.getByText("final scores")).toBeVisible({ timeout: 5000 });

    // Rematch
    await hostPage.getByRole("button", { name: "rematch" }).click();
    await expect(hostPage.getByText("lobby")).toBeVisible({ timeout: 5000 });

    // Team mode should still be enabled with teams visible
    await expect(hostPage.getByText("team 1")).toBeVisible({ timeout: 5000 });
    await expect(hostPage.getByText("team 2")).toBeVisible();

    await hostContext.close();
    await p2Context.close();
  });

  test("team mode toggle hidden when in turns mode", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    await createGame(hostPage);

    // Default is classic mode - teams toggle should be visible
    await expect(hostPage.getByText("teams")).toBeVisible();

    // Switch to turns mode
    await hostPage.getByRole("button", { name: "last one standing" }).click();

    // Teams toggle should not be visible in turns mode
    await expect(hostPage.getByRole("button", { name: "on", exact: true })).not.toBeVisible({ timeout: 5000 });

    await hostContext.close();
  });
});
