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

test.describe("Suggest topic button", () => {
  test("clicking suggest fills the topic input with a random suggestion", async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await setupPlayer(hostPage, "Host");
    await createGame(hostPage);

    // Topic input should be empty initially
    const topicInput = hostPage.getByPlaceholder("e.g. types of cheese");
    await expect(topicInput).toHaveValue("");

    // Click suggest
    await hostPage.getByRole("button", { name: "random" }).click();

    // Input should now have a non-empty value
    const firstSuggestion = await topicInput.inputValue();
    expect(firstSuggestion.length).toBeGreaterThan(0);

    // Click suggest again — should get a (potentially different) suggestion
    await hostPage.getByRole("button", { name: "random" }).click();
    const secondSuggestion = await topicInput.inputValue();
    expect(secondSuggestion.length).toBeGreaterThan(0);

    // The suggestion can be set as the topic
    await hostPage.getByRole("button", { name: "set" }).first().click();
    await expect(
      hostPage.getByText(`topic: ${secondSuggestion}`),
    ).toBeVisible({ timeout: 5000 });

    await hostContext.close();
  });
});
