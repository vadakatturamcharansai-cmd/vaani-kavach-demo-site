import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = ["/", "/architecture", "/try-model", "/team", "/simulation"];

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function accessible(page: Page) {
  // Check final colours after disclosure and state transitions finish.
  await page.waitForTimeout(400);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, elements: nodes.map(n => n.html) }))).toEqual([]);
}

for (const width of [375, 768, 1024, 1440]) {
  test(`routes, contrast and layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      // Allow the existing page entrance animations and web fonts to settle.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, 0));
      await noOverflow(page);
      await accessible(page);
      await page.screenshot({ path: testInfo.outputPath(`${route === "/" ? "home" : route.slice(1)}-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

for (const width of [375, 1440]) {
  test(`complete simulation and replay at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/simulation");
    await page.getByRole("button", { name: "Mute voice announcements", exact: true }).click();
    await page.getByRole("button", { name: "Answer call", exact: true }).click();
    await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unmute microphone", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
    await page.getByRole("button", { name: "Skip to Security Alert" }).click();
    await expect(page.getByRole("heading", { name: "Suspected bank fraud" })).toBeVisible();
    await expect(page.locator(".security-alert")).toContainText("Flagged (verified)");
    await expect(page.locator(".security-alert")).toContainText("12 times");
    await expect(page.locator(".security-alert")).toContainText("92/100");
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`alert-${width}.png`), fullPage: true });
    await accessible(page);
    await page.getByRole("button", { name: "Replay Conversation" }).click();
    await expect(page.getByRole("button", { name: "Skip to Security Alert" })).toBeVisible();
    await expect(page.getByText("Suspected bank fraud")).toHaveCount(0);
    await page.getByRole("button", { name: "Skip to Security Alert" }).click();
    await page.getByRole("button", { name: "Verify Caller", exact: true }).click();
    await expect(page.getByRole("button", { name: "Attempt Transfer" })).toBeDisabled();
    await page.getByRole("button", { name: "Request Voice Challenge" }).click();
    await expect(page.getByText("7294")).toBeVisible();
    await expect(page.getByText('"Seven... two... I cannot hear the rest."')).toBeVisible();
    await expect(page.getByText("Liveness Failed")).toBeVisible();
    await noOverflow(page);
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`verification-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Attempt Transfer" }).click();
    await expect(page.getByText("₹25,000", { exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`payment-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Confirm Transfer" }).click();
    await expect(page.getByText("Call Risk Check")).toBeVisible();
    await expect(page.getByText("Risk Receipt", { exact: true })).toBeVisible();
    await expect(page.getByText("Action Protection API", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transaction Safeguarded" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("API: BLOCK")).toBeVisible();
    await expect(page.getByRole("link", { name: "Understand How It Works" })).toHaveAttribute("href", "/architecture");
    await expect(page.getByRole("link", { name: "Test the Technology" })).toHaveAttribute("href", "/try-model");
    await noOverflow(page);
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`protection-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Restart Experience" }).click();
    await expect(page.getByRole("button", { name: "Answer call", exact: true })).toBeVisible();
  });
}

test("timed transcript and automatic security alert", async ({ page }) => {
  await page.goto("/simulation");
  await page.getByRole("button", { name: "Mute voice announcements", exact: true }).click();
  await page.getByRole("button", { name: "Answer call", exact: true }).click();
  await expect(page.getByText("Hello, am I speaking with the account holder?")).toBeVisible();
  await expect(page.getByText("Analyzing Risk...")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Suspected bank fraud" })).toBeVisible({ timeout: 20_000 });
});

const HEALTH = {
  status: "healthy", model_version: "aasist_multigen5", model_load_ms: 147,
  calibrated: true, spoof_calibrated: true, receipts_enabled: true,
};
const DETECT = {
  status: "success", classification: "AI_SPOOF", action: "VERIFY",
  action_reason: "possible synthetic speech — step-up verification required",
  risk_score: 83, risk_level: "HIGH", spoof_score: 0.9487, confidence: 0.8974,
  audio_quality: "GOOD", timeline: [{ t: 0, risk: 83 }, { t: 1, risk: 79 }],
  signals: [], processing_time_ms: 1206,
  receipt: {
    receipt_id: "83245fad-e17b-43c1-950f-4c7410d8d5da", issued_at: 1790066004,
    expires_at: 1790066304, session_id: "VK-64DF9C62", action: "VERIFY",
    risk_score: 83, risk_level: "HIGH", classification: "AI_SPOOF",
    model_version: "aasist_multigen5", spoof_score: 0.9487, confidence: 0.8974,
    audio_quality: "GOOD", signature: "test-signature",
  },
};

async function stubDetector(page: Page) {
  await page.route("**/health", route => route.fulfill({ json: HEALTH }));
  await page.route("**/api/v1/voice/detect", route => route.fulfill({ json: DETECT }));
  await page.route("**/api/v1/receipt/verify", async route => {
    const sent = route.request().postDataJSON();
    const valid = sent?.risk_score === DETECT.receipt.risk_score;
    await route.fulfill({ json: { valid, reason: valid ? "signature valid" : "signature does not match — receipt was altered or forged" } });
  });
  await page.route("**/api/v1/action/authorize", route => route.fulfill({
    json: { decision: "STEP_UP", risk_level: "HIGH", final_risk: 100, voice_risk: 83,
      voice_verified: true, context_risk: 25, context_reasons: [], step_up_methods: ["trusted_callback"] },
  }));
}

test("architecture details and original workbench controls", async ({ page }) => {
  const diagnostics: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" || message.type() === "warning") diagnostics.push(message.text());
  });
  await stubDetector(page);
  await page.goto("/architecture");
  const nodes = page.locator(".architecture-node");
  await expect(nodes).toHaveCount(8);
  for (let index = 0; index < 8; index++) {
    const title = await nodes.nth(index).locator("strong").innerText();
    await nodes.nth(index).click();
    const disclosure = page.locator(".technical-explanation > button");
    await expect(page.locator("#module-details-title")).toHaveText(title);
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".technical-explanation li").first()).toBeVisible();
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  }
  await page.goto("/try-model");
  await expect(page.getByText("Live detector connected — aasist_multigen5")).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Upload", exact: true }).click()]);
  await chooser.setFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF-test-audio") });
  await expect(page.getByRole("button", { name: "Change File" })).toBeVisible();
  await page.getByRole("button", { name: "Send to Inference Engine" }).click();
  // The verdict on screen is the one the service returned, never a local guess.
  await expect(page.locator(".workbench-output")).toContainText("AI SPOOF");
  await expect(page.locator(".workbench-output")).toContainText("83 / 100");
  await expect(page.locator(".workbench-output")).toContainText("VK-64DF9C62");
  await expect(page.getByText("Code 4213")).toHaveCount(0);

  await page.getByRole("button", { name: "B. API Exchange" }).click();
  await expect(page.getByText("POST /api/v1/voice/detect")).toBeVisible();
  await expect(page.locator("pre").first()).toContainText("voice.wav");

  await page.getByRole("button", { name: "C. Receipt Security" }).click();
  const receipt = page.getByRole("textbox", { name: "Risk receipt JSON" });
  await expect(receipt).toHaveValue(/VK-64DF9C62/);
  await page.getByRole("button", { name: "Verify signature" }).click();
  await expect(page.getByText("VALID", { exact: true })).toBeVisible();
  // Editing any field must fail the signature and drop the voice evidence.
  await receipt.fill((await receipt.inputValue()).replace('"risk_score": 83', '"risk_score": 0'));
  await page.getByRole("button", { name: "Verify signature" }).click();
  await expect(page.getByText("signature does not match")).toBeVisible();
  await page.getByRole("button", { name: /Attempt/ }).click();
  await expect(page.getByText("STEP_UP", { exact: true })).toBeVisible();
  expect(diagnostics).toEqual([]);
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`mobile modules scroll to details and back with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion });
    await page.goto("/architecture");
    const nodes = page.locator(".architecture-node");
    const details = page.locator("#module-details");
    const heading = page.locator("#module-details-title");

    // The initially selected module must scroll too, as must distant selections.
    for (const index of [0, 7, 3]) {
      const title = await nodes.nth(index).locator("strong").innerText();
      await nodes.nth(index).click();
      await expect(heading).toHaveText(title);
      await expect(details).toBeFocused();
      await expect(heading).toBeInViewport();
      await expect.poll(async () => heading.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThan(64);
      await page.getByRole("button", { name: "Back to modules" }).click();
      await expect(nodes.nth(index)).toBeFocused();
      await expect(nodes.nth(index)).toBeInViewport();
    }

    await nodes.nth(3).click();
    await page.getByRole("button", { name: "Technical details", exact: true }).click();
    await expect(page.locator(".technical-explanation li").first()).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading).toHaveText("Assess the risk");
    await expect(heading).toBeInViewport();
    await expect(page.getByRole("button", { name: "Technical details", exact: true })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(heading).toHaveText("Verify the caller");
    await noOverflow(page);
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`module-details-${reducedMotion}.png`), fullPage: true });
  });
}

test("desktop module selection keeps focus on the module", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/architecture");
  const moduleButton = page.locator("#module-processing");
  await moduleButton.click();
  await expect(moduleButton).toBeFocused();
  await expect(page.locator("#module-details-title")).toHaveText("Prepare the audio");
  await expect(page.getByRole("button", { name: "Back to modules" })).toBeHidden();
  await noOverflow(page);
});

test("team page shows the supplied members, portraits and profile links", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/team");

  const members = [
    ["Panchagnula Abhinav", "abhinavpanchagni", "panchagnula-abhinav-674538333"],
    ["Vadakattu Sai Ram Charan", "vadakatturamcharansai-cmd", "ram-charan-sai-vadakattu-9a8911385"],
    ["Lahari Raaparthi", "lahari936", "lahari-raaparthi-605bb9308"],
    ["Sushruth Chari Ramneti", "susruthchari", "susruth-chari-ramneti-763203380"],
    ["Sathwika Pathi", "sathwikapathi", "sathwika-pathi-37898933b"],
  ];

  const cards = page.locator(".team-card");
  await expect(cards).toHaveCount(members.length);
  for (const [index, [name, githubUser, linkedinProfile]] of members.entries()) {
    const card = cards.nth(index);
    await expect(card.getByRole("heading", { name })).toBeVisible();
    await expect(card.getByRole("img", { name: `Portrait of ${name}` })).toBeVisible();
    await expect(card.getByRole("link", { name: `${name} on GitHub` })).toHaveAttribute("href", new RegExp(`github\\.com/${githubUser}$`));
    await expect(card.getByRole("link", { name: `${name} on LinkedIn` })).toHaveAttribute("href", new RegExp(`linkedin\\.com/in/${linkedinProfile}$`));
  }

  await noOverflow(page);
  await accessible(page);
});

test("mobile navigation, keyboard focus and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Suspected fraud call", { exact: true })).toBeVisible();
  await expect(page.getByText("Citizen's phone", { exact: true })).toBeVisible();
  await expect(page.locator(".voice-graphic")).not.toContainText(/payment/i);
  await expect(page.locator(".voice-graphic")).not.toContainText(/incoming call/i);
  await expect(page.getByText("Call in progress", { exact: true })).toHaveCount(2);
  expect(await page.locator(".graphic-warning").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  expect(await page.locator(".graphic-phone").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Vaani Kavach", exact: true })).toBeFocused();
  expect(await page.locator(":focus").evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.locator("#mobile-navigation").getByRole("link", { name: "System Overview" }).click();
  await expect(page).toHaveURL(/\/architecture$/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
});
