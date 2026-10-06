import { test, expect, type Page } from "@playwright/test";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "test@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-10-06T00:00:00Z" };
const thread = { id: THREAD_ID, title: "Testowa rozmowa", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", pinned: false, sort_order: 0 };

async function mockChat(page: Page, initialMessages: unknown[] = [], responseDelay = 250, secondThread = false) {
  const requests: Record<string, unknown>[] = [];
  const messageLoads: string[] = [];
  const mutations: { method: string; path: string; body: unknown }[] = [];
  await page.context().addCookies([{ name: "sb-placeholder-auth-token", value: "base64-" + Buffer.from(JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user })).toString("base64url"), domain: "127.0.0.1", path: "/" }]);
  await page.route("https://placeholder.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (method !== "GET") mutations.push({ method, path: url.pathname, body: route.request().postDataJSON() });
    let body: unknown = [];
    if (url.pathname.endsWith("/user")) body = user;
    else if (url.pathname.endsWith("/chat_threads") && method === "GET") body = secondThread ? [thread, { ...thread, id: "77777777-7777-4777-8777-777777777777", title: "Druga rozmowa" }] : [thread];
    else if (url.pathname.endsWith("/chat_messages") && method === "GET") {
      messageLoads.push(url.searchParams.get("thread_id") ?? "");
      if (url.searchParams.get("thread_id")?.includes("77777777")) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        body = [{ id: "88888888-8888-4888-8888-888888888888", role: "assistant", content: "Odpowiedź z drugiej rozmowy.", message_order: 1 }];
      } else body = initialMessages;
    }
    await route.fulfill({ status: method === "GET" ? 200 : 204, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: method === "GET" ? JSON.stringify(body) : undefined });
  });
  await page.route("**/api/chat", async (route) => {
    const payload = route.request().postDataJSON(); requests.push(payload);
    const requestNumber = requests.length;
    await new Promise((resolve) => setTimeout(resolve, responseDelay));
    const frames = [
      { type: "thread", threadId: THREAD_ID, thread, userMessageId: `33333333-3333-4333-8333-${String(requestNumber).padStart(12, "0")}` },
      { type: "tool_start", tool: { id: "search", name: "search_sejm_data", status: "running", input: '{"query":"Sejm"}' } },
      { type: "tool_end", tool: { id: "search", name: "search_sejm_data", status: "done", output: "Znaleziono dane." } },
      { type: "response", messages: [{ role: "assistant", content: "Gotowe.\n\n| Fakt | Dane |\n|---|---|\n| Data | 2026 |" }] },
      { type: "done", threadId: THREAD_ID, assistantMessageId: `44444444-4444-4444-8444-${String(requestNumber).padStart(12, "0")}`, workedFor: 1, sources: ["https://tygodniksejmowy.pl/"] },
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('[data-slot="chat-input-textarea"]')).toBeEnabled();
  return { requests, mutations, errors, messageLoads };
}

test("simple chat preserves literal input and attachments, shows sources and has no navbar or harness", async ({ page }) => {
  const { requests, mutations, errors } = await mockChat(page);
  await expect(page.locator('[data-slot="chat-navbar"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zmień motyw" })).toBeVisible();
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("/pismo Cena $100 i @dokument");
  await page.locator('input[type="file"]').setInputFiles({ name: "projekt.md", mimeType: "text/markdown", buffer: Buffer.from("# Projekt ustawy\nArtykuł 1.") });
  await input.press("Enter");
  await expect(page.locator('[data-slot="chat-sources"]')).toContainText("tygodniksejmowy.pl");
  expect(requests[0]).toMatchObject({ content: "/pismo Cena $100 i @dokument", documents: [{ name: "projekt.md", content: "# Projekt ustawy\nArtykuł 1." }] });
  expect(requests[0]).not.toHaveProperty("mode");
  await expect(page.locator('[data-slot="file-preview"], [data-slot="plan-card"], [data-slot="ask-question"], [data-slot="context-meter"], [data-slot="chat-input-queue"], [data-slot="message-tool-call"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zmień tryb" })).toHaveCount(0);
  await expect(page.getByRole("table")).toBeVisible();
  const row = page.locator('[data-slot="sidebar-item"]').first();
  await expect(row.locator('[data-slot="sidebar-item-subtitle"]')).toBeVisible();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  await page.locator('[data-slot="sidebar-item-input"]').fill("Nowa nazwa");
  await page.locator('[data-slot="sidebar-item-input"]').press("Enter");
  await expect.poll(() => mutations.some((mutation) => mutation.method === "PATCH" && (mutation.body as { title?: string }).title === "Nowa nazwa")).toBe(true);
  await page.screenshot({ path: "test-results/asystent-rp-desktop.png" });
  expect(errors).toEqual([]);
});

test("rejects unsupported attachments and restores the message", async ({ page }) => {
  const { requests, errors } = await mockChat(page);
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("Pytanie o załącznik");
  await page.locator('input[type="file"]').setInputFiles({ name: "bad.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await input.press("Enter");
  await expect(input).toHaveValue("Pytanie o załącznik");
  expect(requests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("mobile drawer, new chat and composer work without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const { errors } = await mockChat(page);
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("Pierwszy wiersz\nDrugi wiersz");
  expect(await input.evaluate((element) => getComputedStyle(element).whiteSpace)).not.toBe("nowrap");
  await page.getByRole("button", { name: "Otwórz rozmowy", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rozmowy" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Rozmowy" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Otwórz rozmowy", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Nowa rozmowa", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(page.getByText("W czym mogę pomóc?", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Otwórz rozmowy", exact: true }).click();
  await page.getByRole("dialog", { name: "Rozmowy" }).getByRole("button", { name: "Nowa rozmowa", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rozmowy" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/asystent-rp-mobile.png" });
  expect(errors).toEqual([]);
});

test("shows loading rather than new-chat suggestions when switching, then reuses loaded conversations", async ({ page }) => {
  const { errors, messageLoads } = await mockChat(page, [{ id: "a", role: "assistant", content: "Pierwsza odpowiedź.", message_order: 1 }], 250, true);
  await expect(page.getByText("Pierwsza odpowiedź.", { exact: true })).toBeVisible();
  const second = page.locator('[data-slot="sidebar-item"]').filter({ hasText: "Druga rozmowa" });
  await second.locator('[data-slot="sidebar-item-button"]').click();
  await expect(page.getByRole("status", { name: "Ładowanie rozmowy" })).toBeVisible();
  await expect(page.getByText("W czym mogę pomóc?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Co wydarzyło się na ostatnim posiedzeniu Sejmu?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Odpowiedź z drugiej rozmowy.", { exact: true })).toBeVisible();
  await page.locator('[data-slot="sidebar-item"]').filter({ hasText: "Testowa rozmowa" }).locator('[data-slot="sidebar-item-button"]').click();
  await expect(page.getByText("Pierwsza odpowiedź.", { exact: true })).toBeVisible();
  await second.locator('[data-slot="sidebar-item-button"]').click();
  await expect(page.getByText("Odpowiedź z drugiej rozmowy.", { exact: true })).toBeVisible();
  expect(messageLoads).toHaveLength(2);
  expect(errors).toEqual([]);
});

test("sidebar follows resize gestures immediately and persists its actual width", async ({ page }) => {
  const { errors } = await mockChat(page);
  const sidebar = page.locator('[data-slot="chat-sidebar"]');
  const before = (await sidebar.boundingBox())!.width;
  const rail = page.getByRole("separator", { name: "Zmień szerokość panelu" });
  const bounds = (await rail.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 120);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + 120, { steps: 5 });
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(before + 80, 0);
  expect(await sidebar.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Number(localStorage.getItem("asystent-rp.sidebar-width")))).toBeCloseTo(before + 80, 0);
  await page.getByRole("button", { name: "Zwiń panel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Otwórz panel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Otwórz panel", exact: true }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(before + 80, 0);
  expect(errors).toEqual([]);
});

test("keeps old presentation tools hidden and stops generation without a queue", async ({ page }) => {
  const { requests, errors } = await mockChat(page, [{ id: "a", role: "assistant", content: "Poprzednia odpowiedź.", message_order: 1, process: { workedFor: 4, parts: [{ type: "tool", id: "p", tool: { id: "plan", name: "create_plan", status: "done", input: JSON.stringify({ title: "Plan analizy", plan: "Sprawdź etap.", todos: [] }) } }] } }], 2000);
  await expect(page.getByText("Poprzednia odpowiedź.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="plan-card"], [data-slot="file-preview"]')).toHaveCount(0);
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("Pierwsze pytanie"); await input.press("Enter");
  await expect.poll(() => requests.length).toBe(1);
  await expect(input).toBeDisabled();
  await expect(page.locator('[data-slot="chat-input-queue"]')).toHaveCount(0);
  await page.locator('[data-slot="chat-input-stop"]').click();
  await expect(input).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});
