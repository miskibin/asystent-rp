import { test, expect, type Page } from "@playwright/test";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "test@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-10-06T00:00:00Z" };
const thread = { id: THREAD_ID, title: "Testowa rozmowa", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", pinned: false, sort_order: 0 };

async function mockChat(page: Page, initialMessages: unknown[] = [], responseDelay = 250) {
  const requests: Record<string, unknown>[] = [];
  const mutations: { method: string; path: string; body: unknown }[] = [];
  await page.context().addCookies([{ name: "sb-placeholder-auth-token", value: "base64-" + Buffer.from(JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user })).toString("base64url"), domain: "127.0.0.1", path: "/" }]);
  await page.route("https://placeholder.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (method !== "GET") mutations.push({ method, path: url.pathname, body: route.request().postDataJSON() });
    let body: unknown = [];
    if (url.pathname.endsWith("/user")) body = user;
    else if (url.pathname.endsWith("/chat_threads") && method === "GET") body = [thread];
    else if (url.pathname.endsWith("/chat_messages") && method === "GET") body = initialMessages;
    await route.fulfill({ status: method === "GET" ? 200 : 204, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: method === "GET" ? JSON.stringify(body) : undefined });
  });
  await page.route("**/api/chat", async (route) => {
    const payload = route.request().postDataJSON(); requests.push(payload);
    const requestNumber = requests.length;
    await new Promise((resolve) => setTimeout(resolve, responseDelay));
    const frames = [
      { type: "thread", threadId: THREAD_ID, thread, userMessageId: `33333333-3333-4333-8333-${String(requestNumber).padStart(12, "0")}` },
      { type: "tool_start", tool: { id: "draft", name: "draft_document", status: "running", input: JSON.stringify({ title: "Wniosek", content: "# Wniosek\n\nTreść dokumentu." }) } },
      { type: "tool_end", tool: { id: "draft", name: "draft_document", status: "done", output: "Dokument gotowy." } },
      { type: "response", messages: [{ role: "assistant", content: "Gotowe.\n\n| Fakt | Dane |\n|---|---|\n| Data | 2026 |" }] },
      { type: "done", threadId: THREAD_ID, assistantMessageId: `44444444-4444-4444-8444-${String(requestNumber).padStart(12, "0")}`, workedFor: 1, sources: ["https://tygodniksejmowy.pl/"] },
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('[data-slot="chat-input-textarea"]')).toBeEnabled();
  return { requests, mutations, errors };
}

test("uses real composer, document preview, localized modes, sources and navigation mutations", async ({ page }) => {
  const { requests, mutations, errors } = await mockChat(page);
  await page.getByRole("button", { name: "Zmień tryb" }).click();
  await page.getByRole("menuitemradio", { name: /Plan/ }).click();
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("/pismo przygotuj wniosek");
  await page.locator('input[type="file"]').setInputFiles({ name: "projekt.md", mimeType: "text/markdown", buffer: Buffer.from("# Projekt ustawy\nArtykuł 1.") });
  await input.press("Enter");
  await expect(page.locator('[data-slot="message-artifact-trigger"]')).toBeVisible();
  expect(requests[0]).toMatchObject({ mode: "plan", documents: [{ name: "projekt.md", content: "# Projekt ustawy\nArtykuł 1." }] });
  expect(String(requests[0].content)).toContain("wersję roboczą pisma");
  await expect(page.locator('[data-slot="chat-sources"]')).toContainText("tygodniksejmowy.pl");
  await page.locator('[data-slot="message-artifact-trigger"]').click();
  await expect(page.locator('[data-slot="file-preview"]')).toBeVisible();
  await page.getByLabel("Porównaj z:").selectOption({ label: "projekt.md" });
  await expect(page.locator('[data-slot="diff-view"]')).toBeVisible();
  await page.screenshot({ path: "test-results/asystent-rp-desktop.png" });
  await page.getByLabel("Szukaj rozmów").fill("Testowa");
  const row = page.locator('[data-slot="sidebar-item"]').first();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  await page.locator('[data-slot="sidebar-item-input"]').fill("Nowa nazwa");
  await page.locator('[data-slot="sidebar-item-input"]').press("Enter");
  await expect.poll(() => mutations.some((mutation) => mutation.method === "PATCH" && (mutation.body as { title?: string }).title === "Nowa nazwa")).toBe(true);
  expect(errors).toEqual([]);
});

test("keeps saved drafts and rejected attachments, without sending either automatically", async ({ page }) => {
  const { requests, errors } = await mockChat(page);
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("Mój szkic"); await input.press("Control+s");
  await expect(page.locator('[data-slot="chat-input-queue"]')).toContainText("Mój szkic");
  expect(requests).toHaveLength(0);
  await input.fill("Pytanie o załącznik");
  await page.locator('input[type="file"]').setInputFiles({ name: "bad.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await input.press("Enter");
  await expect(input).toHaveValue("Pytanie o załącznik");
  expect(requests).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("mobile drawer is keyboard-accessible and the composer supports multiple lines", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const { errors } = await mockChat(page);
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("Pierwszy wiersz\nDrugi wiersz");
  expect(await input.evaluate((element) => getComputedStyle(element).whiteSpace)).not.toBe("nowrap");
  await page.getByRole("button", { name: "Otwórz rozmowy", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rozmowy" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Rozmowy" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/asystent-rp-mobile.png" });
  expect(errors).toEqual([]);
});

test("queues the next prompt while generating and sends it exactly once after the current reply", async ({ page }) => {
  const { requests, errors } = await mockChat(page, [], 1500);
  const input = page.locator('[data-slot="chat-input-textarea"]');
  await input.fill("Pierwsze pytanie"); await input.press("Enter");
  await expect.poll(() => requests.length).toBe(1);
  await expect(input).toBeEnabled();
  await input.fill("Drugie pytanie"); await input.press("Enter");
  await expect(page.locator('[data-slot="chat-input-queue"]')).toContainText("Drugie pytanie");
  expect(requests).toHaveLength(1);
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator('[data-slot="chat-input-queue"]')).toHaveCount(0);
  expect(requests.map((request) => request.content)).toEqual(["Pierwsze pytanie", "Drugie pytanie"]);
  expect(errors).toEqual([]);
});

test("persists an answer to an agent question before continuing the conversation", async ({ page }) => {
  const messageId = "55555555-5555-4555-8555-555555555555";
  const { requests, mutations, errors } = await mockChat(page, [{ id: messageId, role: "assistant", content: "Wybierz zakres.", message_order: 1, process: { parts: [{ type: "tool", id: "ask-part", tool: { id: "ask", name: "ask_question", status: "done", input: JSON.stringify({ title: "Zakres", questions: [{ id: "scope", prompt: "Jaki zakres?", options: [{ id: "summary", label: "Podsumowanie" }, { id: "detail", label: "Szczegóły" }] }] }), output: '{"answers":{},"source":"agent"}' } }] } }]);
  await page.getByRole("radio", { name: "Podsumowanie", exact: true }).click();
  await page.locator('[data-slot="ask-question-submit"]').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].content).toBe("Jaki zakres?: Podsumowanie");
  expect(mutations.some((mutation) => mutation.method === "PATCH" && JSON.stringify(mutation.body).includes('\\"source\\":\\"user\\"'))).toBe(true);
  await page.getByRole("button", { name: "Worked for a while", exact: true }).click();
  await page.locator('[data-tool-id="ask"] [data-slot="message-tool-call-trigger"]').click();
  await expect(page.locator('[data-slot="ask-question-summary"]')).toContainText("Podsumowanie");
  expect(errors).toEqual([]);
});

test("opens a persisted plan and starts its analysis from the document panel", async ({ page }) => {
  const { requests, errors } = await mockChat(page, [{ id: "66666666-6666-4666-8666-666666666666", role: "assistant", content: "Plan gotowy.", message_order: 1, process: { parts: [{ type: "tool", id: "plan-part", tool: { id: "plan", name: "create_plan", status: "done", input: JSON.stringify({ title: "Plan analizy ustawy", plan: "# Analiza\nSprawdź etap prac.", todos: [{ content: "Sprawdź etap", status: "pending" }] }), output: "Plan przedstawiony." } }] } }]);
  await page.locator('[data-slot="plan-card-header"]').click();
  await expect(page.locator('[data-slot="file-preview"]')).toBeVisible();
  await page.getByRole("button", { name: "Rozwiń analizę", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].content).toContain("Plan analizy ustawy");
  expect(errors).toEqual([]);
});
