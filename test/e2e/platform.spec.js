const { test, expect } = require("@playwright/test");
const { DateTime } = require("luxon");
const date = DateTime.now()
  .setZone("America/New_York")
  .plus({ days: 3 })
  .toISODate();
test("customer booking and administrator workflow preserve responsive experience", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Booking", exact: true }),
  ).toBeVisible();
  await page.locator("#name").fill("Browser Test Client");
  await page.locator("#email").fill("browser@example.invalid");
  await page.locator("#date").fill(date);
  await page.locator("#date").dispatchEvent("change");
  await expect(page.locator("#starts_at")).toBeEnabled();
  await page.locator("#starts_at").selectOption({ index: 1 });
  await page.locator("#message").fill("<script>synthetic notes</script>");
  await page.getByRole("button", { name: "SEND W/ LOVE" }).click();
  await expect(page.locator("#booking-success")).toBeVisible();
  await page.goto("/admin.html");
  await page.getByLabel("Username", { exact: true }).fill("test-artist");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Appointments", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View details" }).click();
  await expect(page.locator("#detail-content")).toContainText(
    "<script>synthetic notes</script>",
  );
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator("#detail-content")).toContainText(
    "Status: confirmed",
  );
  await page.locator("#filter").selectOption("confirmed");
  await expect(page.locator(".appointment")).toHaveCount(1);
  await page.getByLabel("Duration (minutes)", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Save duration" }).click();
  await expect(page.locator("#notice")).toHaveText(
    "Duration and buffer updated.",
  );
  await page.locator("#availability input[name=date]").fill(date);
  await page.getByLabel("Block date", { exact: true }).check();
  await page.getByRole("button", { name: "Save date" }).click();
  await expect(page.locator("#windows")).toContainText("Blocked");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Cancel appointment", exact: true })
    .click();
  await expect(page.locator("#detail-content")).toContainText(
    "Status: cancelled",
  );
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#booking-form")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#date").fill(date);
  await page.locator("#date").dispatchEvent("change");
  await expect(page.locator("#slot-status")).toContainText(
    "No times available",
  );
  await page.screenshot({
    path: "test-results/public-mobile.png",
    fullPage: true,
  });
  await page.goto("/admin.html");
  await page.getByLabel("Username", { exact: true }).fill("test-artist");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#dashboard")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });
});
