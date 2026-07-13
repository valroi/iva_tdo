// Съёмка скринов встроенного гида → public/guide/*.png
// Запуск: node scripts/shoot-guide.mjs  (нужны backend:8000 и vite:3000)
// Пересъёмка после изменений UI — перезапустить скрипт.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";
const OUT = new URL("../public/guide/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const USERS = {
  admin: { email: "admin@ivamaris.io", password: "admin123" },
  con_tdo: { email: "con_tdo@mail.ru", password: "Password_123!" },
  dev: { email: "dev@mail.ru", password: "Password_123!" },
  lr: { email: "lr@mail.ru", password: "Password_123!" },
  r: { email: "r@mail.ru", password: "Password_123!" },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function openAs(profile, hash) {
  const { email, password } = USERS[profile];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${profile}: ${res.status}`);
  const tokens = await res.json();
  await page.goto(`${BASE}/?profile=${profile}#/${hash}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([p, a, r]) => {
      localStorage.setItem(`tdo_access_token_${p}`, a);
      localStorage.setItem(`tdo_refresh_token_${p}`, r);
    },
    [profile, tokens.access_token, tokens.refresh_token],
  );
  // ВАЖНО: reload, не goto — goto на тот же hash-URL документ не перезагружает.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
}
const shot = async (n) => { await page.screenshot({ path: `${OUT}${n}.png` }); console.log("✓", n); };
const clickTab = async (re) => {
  const tabs = page.locator(".ant-tabs-tab");
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    if (re.test(await tabs.nth(i).innerText())) { await tabs.nth(i).click(); await page.waitForTimeout(700); return true; }
  }
  return false;
};

// 0. Вход
await page.goto(`${BASE}/?profile=shoot0#/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await shot("01-login");

// Рук. ТДО подрядчика
await openAs("con_tdo", "dashboard");
await shot("10-tdo-dashboard");
await openAs("con_tdo", "documents_registry");
await shot("11-tdo-registry");
await openAs("con_tdo", "projects");
if (await clickTab(/Реестр документов/)) {
  await shot("12-tdo-mdr");
  const addBtn = page.getByRole("button", { name: /Добавить документ/ }).first();
  if (await addBtn.count()) {
    await addBtn.click();
    await page.waitForTimeout(700);
    await shot("13-tdo-mdr-create");
    const catSel = page.locator(".ant-modal .ant-form-item", { hasText: "Категория документа" }).locator(".ant-select").first();
    if (await catSel.count()) {
      await catSel.click();
      await page.waitForTimeout(400);
      const seOpt = page.locator(".ant-select-item-option", { hasText: /^SE/ }).first();
      if (await seOpt.count()) {
        await seOpt.click();
        await page.waitForTimeout(500);
        await shot("14-tdo-mdr-create-se");
      }
    }
  }
}
await openAs("con_tdo", "tdo_queue");
await shot("15-tdo-queue");

// Разработчик
await openAs("dev", "revisions");
await shot("20-dev-revisions");
const cardBtn = page.getByRole("button", { name: "Карточка ревизии" }).first();
if (await cardBtn.count()) {
  await cardBtn.click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1100);
  await shot("21-dev-revision-card");
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(400);
  await shot("22-dev-revision-card-scroll");
}

// LR заказчика
await openAs("lr", "documents_registry");
await shot("30-lr-registry");
await openAs("lr", "crs_queue");
await shot("31-lr-crs");
await openAs("lr", "revisions");
const cardBtnLr = page.getByRole("button", { name: "Карточка ревизии" }).first();
if (await cardBtnLr.count()) {
  await cardBtnLr.click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1100);
  await shot("32-lr-revision-card");
}

// R заказчика
await openAs("r", "documents_registry");
await shot("40-r-registry");

// Админ
await openAs("admin", "projects");
if (await clickTab(/матриц/i)) { /* таб найден */ }
await shot("50-admin-matrix");
await openAs("admin", "admin");
await shot("51-admin-users");

await browser.close();
console.log("DONE →", OUT);
