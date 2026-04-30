import { chromium } from "playwright";

const API = "http://127.0.0.1:8000/api/v1";
const APP = "http://127.0.0.1:3016";
const ADMIN_EMAIL = "admin@ivamaris.io";
const ADMIN_PASSWORD = "admin123";
const DEFAULT_PASSWORD = "Password_123!";

async function apiLogin(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed ${email}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function apiRequest(token, path, method = "GET", body = undefined) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function uploadRevisionPdfViaApi(token, revisionId) {
  const pdfBytes = `%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 42 >>
stream
BT /F1 12 Tf 72 72 Td (UI E2E PDF) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000207 00000 n 
trailer
<< /Root 1 0 R /Size 5 >>
startxref
300
%%EOF`;
  const form = new FormData();
  form.append("revision_id", String(revisionId));
  form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "ui-e2e.pdf");
  return apiRequest(token, "/documents/upload", "POST", form);
}

async function setupFixture() {
  const admin = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(-8);
  const projectCode = `UI${stamp.slice(-6)}`;
  const users = {
    tdo: { email: `ui.tdo.${stamp}@ivamaris.io`, full_name: "UI TDO Lead", company_type: "contractor", company_code: "CTR" },
    dev: { email: `ui.dev.${stamp}@ivamaris.io`, full_name: "UI Contractor Dev", company_type: "contractor", company_code: "CTR" },
    lr: { email: `ui.lr.${stamp}@ivamaris.io`, full_name: "UI Owner LR", company_type: "owner", company_code: "OWN" },
    r: { email: `ui.r.${stamp}@ivamaris.io`, full_name: "UI Owner R", company_type: "owner", company_code: "OWN" },
  };

  for (const key of Object.keys(users)) {
    users[key] = await apiRequest(admin, "/users", "POST", { ...users[key], password: DEFAULT_PASSWORD, role: "user" });
  }

  const no = {
    can_manage_users: false,
    can_manage_projects: false,
    can_edit_project_references: false,
    can_manage_review_matrix: false,
    can_view_reporting: false,
    can_create_mdr: false,
    can_upload_files: false,
    can_comment: false,
    can_raise_comments: false,
    can_respond_comments: false,
    can_publish_comments: false,
    can_edit_workflow_statuses: false,
    can_process_tdo_queue: false,
  };
  const perms = {
    tdo: { ...no, can_create_mdr: true, can_upload_files: true, can_process_tdo_queue: true },
    dev: { ...no, can_upload_files: true, can_respond_comments: true },
    lr: { ...no, can_raise_comments: true, can_publish_comments: true },
    r: { ...no, can_raise_comments: true },
  };
  for (const key of Object.keys(users)) {
    await apiRequest(admin, `/users/${users[key].id}/permissions`, "PUT", { permissions: perms[key] });
  }

  const project = await apiRequest(admin, "/projects", "POST", {
    code: projectCode,
    name: `UI E2E ${projectCode}`,
    document_category: "PD",
  });

  for (const [key, role] of Object.entries({
    tdo: "contractor_tdo_lead",
    dev: "contractor_member",
    lr: "owner_member",
    r: "owner_member",
  })) {
    await apiRequest(admin, `/projects/${project.id}/members`, "POST", {
      user_id: users[key].id,
      member_role: role,
    });
  }
  await apiRequest(admin, `/projects/${project.id}/review-matrix`, "POST", {
    user_id: users.lr.id,
    discipline_code: "AR",
    doc_type: "DWG",
    level: 1,
    state: "LR",
  });
  await apiRequest(admin, `/projects/${project.id}/review-matrix`, "POST", {
    user_id: users.r.id,
    discipline_code: "AR",
    doc_type: "DWG",
    level: 1,
    state: "R",
  });

  const tdoToken = await apiLogin(users.tdo.email, DEFAULT_PASSWORD);
  const mdr = await apiRequest(tdoToken, "/mdr", "POST", {
    document_key: `${projectCode}-KEY-01`,
    project_code: projectCode,
    originator_code: "CTR",
    category: "PD",
    title_object: "BLDG",
    discipline_code: "AR",
    doc_type: "DWG",
    serial_number: "0001",
    doc_number: `${projectCode}-CTR-PD-0001-AR1.1`,
    doc_name: "UI E2E Document",
    progress_percent: 0,
    doc_weight: 1,
    issue_purpose: "IFR",
    revision: "A",
    dates: {},
    status: "IN_REVIEW",
    contractor_responsible_id: users.dev.id,
    owner_responsible_id: users.lr.id,
    is_confidential: false,
  });
  const doc = await apiRequest(tdoToken, "/documents", "POST", {
    mdr_id: mdr.id,
    document_num: mdr.doc_number,
    title: "UI E2E Document",
    discipline: "AR",
    weight: 1,
  });
  const devToken = await apiLogin(users.dev.email, DEFAULT_PASSWORD);
  const rev = await apiRequest(devToken, "/revisions", "POST", {
    document_id: doc.id,
    revision_code: "A",
    issue_purpose: "IFR",
    author_id: users.dev.id,
  });
  await uploadRevisionPdfViaApi(devToken, rev.id);
  await apiRequest(tdoToken, `/revisions/${rev.id}/tdo-decision`, "POST", { action: "SEND_TO_OWNER" });

  const rToken = await apiLogin(users.r.email, DEFAULT_PASSWORD);
  const lrToken = await apiLogin(users.lr.email, DEFAULT_PASSWORD);
  const ownerOpenRemark = await apiRequest(rToken, "/comments", "POST", {
    revision_id: rev.id,
    text: "[REMARK] UI workflow open remark",
    status: "OPEN",
    review_code: "CO",
    page: 1,
    area_x: 80,
    area_y: 80,
    area_w: 120,
    area_h: 30,
  });
  const ownerDiscussRemark = await apiRequest(lrToken, "/comments", "POST", {
    revision_id: rev.id,
    text: "[REMARK] UI workflow discuss remark",
    status: "OPEN",
    review_code: "AN",
    page: 1,
    area_x: 80,
    area_y: 120,
    area_w: 120,
    area_h: 30,
  });
  try {
    await apiRequest(lrToken, `/comments/${ownerDiscussRemark.id}/owner-decision`, "POST", { action: "PUBLISH" });
    await apiRequest(devToken, `/comments/${ownerDiscussRemark.id}/response`, "POST", {
      text: "Принято к рассмотрению",
      status: "IN_PROGRESS",
      contractor_status: "I",
    });
  } catch {
    // Keep fixture usable even if this optional branch is rejected by workflow guards.
  }

  const rjDocNum = `${projectCode}-CTR-PD-0002-AR1.1`;
  const doneDocNum = `${projectCode}-CTR-PD-0003-AR1.1`;
  const mdrRj = await apiRequest(tdoToken, "/mdr", "POST", {
    document_key: `${projectCode}-KEY-02`,
    project_code: projectCode,
    originator_code: "CTR",
    category: "PD",
    title_object: "BLDG",
    discipline_code: "AR",
    doc_type: "DWG",
    serial_number: "0002",
    doc_number: rjDocNum,
    doc_name: "UI RJ Document",
    progress_percent: 0,
    doc_weight: 1,
    issue_purpose: "IFR",
    revision: "A",
    dates: {},
    status: "IN_REVIEW",
    contractor_responsible_id: users.dev.id,
    owner_responsible_id: users.lr.id,
    is_confidential: false,
  });
  const docRj = await apiRequest(tdoToken, "/documents", "POST", {
    mdr_id: mdrRj.id,
    document_num: rjDocNum,
    title: "UI RJ Document",
    discipline: "AR",
    weight: 1,
  });
  const revRj = await apiRequest(devToken, "/revisions", "POST", {
    document_id: docRj.id,
    revision_code: "A",
    issue_purpose: "IFR",
    author_id: users.dev.id,
  });
  await uploadRevisionPdfViaApi(devToken, revRj.id);
  await apiRequest(tdoToken, `/revisions/${revRj.id}/tdo-decision`, "POST", { action: "SEND_TO_OWNER" });
  const rjRemark = await apiRequest(lrToken, "/comments", "POST", {
    revision_id: revRj.id,
    text: "[REMARK] UI RJ blocking remark",
    status: "OPEN",
    review_code: "RJ",
    page: 1,
    area_x: 60,
    area_y: 80,
    area_w: 140,
    area_h: 30,
  });
  await apiRequest(lrToken, `/comments/${rjRemark.id}/owner-decision`, "POST", { action: "PUBLISH" });
  let rjBlocked = false;
  try {
    await apiRequest(devToken, "/revisions", "POST", {
      document_id: docRj.id,
      revision_code: "B",
      issue_purpose: "IFR",
      author_id: users.dev.id,
    });
  } catch {
    rjBlocked = true;
  }

  const mdrDone = await apiRequest(tdoToken, "/mdr", "POST", {
    document_key: `${projectCode}-KEY-03`,
    project_code: projectCode,
    originator_code: "CTR",
    category: "PD",
    title_object: "BLDG",
    discipline_code: "AR",
    doc_type: "DWG",
    serial_number: "0003",
    doc_number: doneDocNum,
    doc_name: "UI Completed Document",
    progress_percent: 100,
    doc_weight: 1,
    issue_purpose: "AFD",
    revision: "00",
    dates: {},
    status: "IN_REVIEW",
    contractor_responsible_id: users.dev.id,
    owner_responsible_id: users.lr.id,
    is_confidential: false,
  });
  const docDone = await apiRequest(tdoToken, "/documents", "POST", {
    mdr_id: mdrDone.id,
    document_num: doneDocNum,
    title: "UI Completed Document",
    discipline: "AR",
    weight: 1,
  });
  const revDone = await apiRequest(devToken, "/revisions", "POST", {
    document_id: docDone.id,
    revision_code: "00",
    issue_purpose: "AFD",
    author_id: users.dev.id,
  });
  await uploadRevisionPdfViaApi(devToken, revDone.id);
  await apiRequest(tdoToken, `/revisions/${revDone.id}/tdo-decision`, "POST", { action: "SEND_TO_OWNER" });
  await apiRequest(lrToken, `/revisions/${revDone.id}/review-code`, "POST", { review_code: "AP" });

  const usersList = await apiRequest(admin, "/users", "GET");
  const byEmail = new Map(usersList.map((item) => [item.email, item]));
  const usersWithEffectivePermissions = {
    tdo: byEmail.get(users.tdo.email) ?? users.tdo,
    dev: byEmail.get(users.dev.email) ?? users.dev,
    lr: byEmail.get(users.lr.email) ?? users.lr,
    r: byEmail.get(users.r.email) ?? users.r,
  };

  return {
    users: usersWithEffectivePermissions,
    projectCode,
    documentNum: doc.document_num,
    revisionId: rev.id,
    seededComments: [ownerOpenRemark.id, ownerDiscussRemark.id],
    rjDocNum,
    doneDocNum,
    rjBlocked,
  };
}

async function loginUi(page, email, password) {
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByText("IvaMaris TDO").first().waitFor({ timeout: 15000 });
}

async function openProjectContext(page, projectCode) {
  await page.getByRole("menuitem", { name: "Проекты" }).click();
  await page.getByText("Текущий проект:").first().waitFor({ timeout: 15000 });
  const projectHint = page.getByText(projectCode).first();
  if (!(await projectHint.isVisible().catch(() => false))) {
    await page.locator(".projects-module .ant-select").first().click();
    await page.getByRole("option", { name: new RegExp(projectCode) }).first().click();
  }
  await page.getByRole("tab", { name: "Ревизии и комментарии" }).click();
  await page.getByText(projectCode).first().waitFor({ timeout: 15000 });
}

async function clickIfVisible(page, name, errors) {
  if (await page.locator(".ant-modal-wrap").count()) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }
  const button = page.getByRole("button", { name }).first();
  const count = await button.count();
  if (!count) return false;
  const visible = await button.isVisible().catch(() => false);
  if (!visible) return false;
  const disabled = await button.isDisabled().catch(() => true);
  if (disabled) return false;
  try {
    await button.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape").catch(() => {});
    return true;
  } catch (error) {
    errors.push(`click-${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function checkRoleVisibility(browser, fixture, roleKey) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

  await loginUi(page, fixture.users[roleKey].email, DEFAULT_PASSWORD);
  try {
    await openProjectContext(page, fixture.projectCode);
  } catch (error) {
    await page.screenshot({ path: `ui_e2e_${roleKey}_project_context_error.png`, fullPage: true });
    errors.push(`project-context: ${error instanceof Error ? error.message : String(error)}`);
  }
  let rjUiCreateBlocked = false;
  let completedUiCreateBlocked = false;
  let completedUiShowsDoneTag = false;
  let mutuallyExclusiveCrsReject = false;
  let duplicateRemarkBlocked = false;
  if (roleKey === "dev" || roleKey === "tdo") {
    try {
      const rjRow = page.locator("tr").filter({ hasText: fixture.rjDocNum }).first();
      await rjRow.waitFor({ timeout: 8000 });
      await rjRow.getByRole("button", { name: "Открыть" }).click();
      const createRevisionBtn = page.getByRole("button", { name: "+ Ревизия" }).first();
      if (await createRevisionBtn.isDisabled()) {
        rjUiCreateBlocked = true;
      } else {
        await createRevisionBtn.click();
        const codeInput = page.locator(".ant-modal input[placeholder='A / 00']").first();
        await codeInput.waitFor({ timeout: 5000 });
        const codeValue = ((await codeInput.inputValue()).trim() || "").toUpperCase();
        // UI guard for RJ: revision code auto-locked to same code (A).
        rjUiCreateBlocked = codeValue === "A";
        await page.keyboard.press("Escape").catch(() => {});
      }
    } catch {
      rjUiCreateBlocked = false;
    }
    try {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
      const doneTab = page.getByRole("tab", { name: /Завершенные документы/ }).first();
      if (await doneTab.count()) {
        await doneTab.click();
      } else {
        await page.getByText(/Завершенные документы/).first().click();
      }
      const doneRow = page.locator("tr").filter({ hasText: fixture.doneDocNum }).first();
      const doneVisible = await doneRow.isVisible().catch(() => false);
      if (doneVisible) {
        const doneOpenBtn = doneRow.getByRole("button", { name: "Открыть" }).first();
        if (await doneOpenBtn.count()) {
          await doneOpenBtn.click();
        } else {
          await doneRow.click();
        }
      }
      const createRevisionBtn = page.getByRole("button", { name: "+ Ревизия" }).first();
      completedUiCreateBlocked = (await createRevisionBtn.count()) ? await createRevisionBtn.isDisabled() : false;
      completedUiShowsDoneTag = await page.getByText("Документ завершен (100%)").first().isVisible().catch(() => false);
    } catch {
      completedUiCreateBlocked = false;
      completedUiShowsDoneTag = false;
    }
  }

  if (roleKey === "lr") {
    try {
      const row = page.locator("tr").filter({ hasText: fixture.documentNum }).first();
      await row.waitFor({ timeout: 8000 });
      const hasAddToCrs = (await row.getByRole("button", { name: "Добавить в CRS" }).count()) > 0;
      const hasReject = (await row.getByRole("button", { name: "Отклонить" }).count()) > 0;
      mutuallyExclusiveCrsReject = !(hasAddToCrs && hasReject);
    } catch {
      mutuallyExclusiveCrsReject = false;
    }
    try {
      await clickIfVisible(page, "+ Вопрос/замечание", errors);
      const remarkInput = page.getByPlaceholder("Опиши замечание...").first();
      await remarkInput.waitFor({ timeout: 5000 });
      const statusSelect = page.getByLabel("Статус замечания (RJ/CO/AN)").first();
      if (await statusSelect.count()) {
        await statusSelect.click();
        await page.getByRole("option", { name: /CO - Существенные замечания/ }).first().click();
      }
      const text = "UI duplicate check remark";
      await remarkInput.fill(text);
      const addBtn = page.getByRole("button", { name: "Добавить во временный список" }).first();
      if (await addBtn.count()) {
        await addBtn.click();
        await page.waitForTimeout(300);
        const statusSelectAgain = page.getByLabel("Статус замечания (RJ/CO/AN)").first();
        if (await statusSelectAgain.count()) {
          await statusSelectAgain.click();
          await page.getByRole("option", { name: /CO - Существенные замечания/ }).first().click();
        }
        await remarkInput.fill(text);
        await addBtn.click();
        await page.waitForTimeout(500);
        const bodyText = (await page.locator("body").innerText()).toLowerCase();
        duplicateRemarkBlocked = bodyText.includes("дублик") || bodyText.includes("уже существует");
      }
      await page.keyboard.press("Escape").catch(() => {});
    } catch {
      duplicateRemarkBlocked = false;
    }
  }
  try {
    if (await page.locator(".ant-modal-wrap").count()) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    }
    const docRow = page.locator("tr").filter({ hasText: fixture.documentNum }).first();
    await docRow.waitFor({ timeout: 15000 });
    const openBtn = docRow.getByRole("button", { name: "Открыть" }).first();
    if (await openBtn.count()) {
      await openBtn.click();
    } else {
      await docRow.click();
    }
  } catch (error) {
    await page.screenshot({ path: `ui_e2e_${roleKey}_documents_error.png`, fullPage: true });
    errors.push(`documents-open: ${error instanceof Error ? error.message : String(error)}`);
  }

  const canOpenPdfComment =
    (await page.getByRole("button", { name: "Комментировать PDF" }).count()) > 0 ||
    (await page.getByRole("button", { name: "Открыть PDF" }).count()) > 0 ||
    (await page.getByRole("button", { name: "+ Вопрос/замечание" }).count()) > 0;
  const canSetAp = await page.getByRole("button", { name: "Поставить AP" }).count();
  const canCreateRev = await page.getByRole("button", { name: "+ Ревизия" }).isVisible();
  const canSendToTrm = await page.getByRole("button", { name: "В TRM" }).count();
  const clickedActions = [];
  for (const label of [
    "Комментировать PDF",
    "Открыть PDF",
    "+ Вопрос/замечание",
    "В TRM",
    "+ Ревизия",
    "Поставить AP",
    "Добавить в CRS",
    "Отклонить",
    "Вернуть в работу",
    "Удалить",
    "Финально подтвердить (LR)",
  ]) {
    if (await clickIfVisible(page, label, errors)) clickedActions.push(label);
  }

  await page.close();
  return {
    role: roleKey,
    canOpenPdfComment,
    canSetAp: canSetAp > 0,
    canCreateRev,
    canSendToTrm: canSendToTrm > 0,
    rjUiCreateBlocked,
    completedUiCreateBlocked,
    completedUiShowsDoneTag,
    mutuallyExclusiveCrsReject,
    duplicateRemarkBlocked,
    clickedActions,
    errors,
  };
}

async function main() {
  const fixture = await setupFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const results = await Promise.all(["tdo", "dev", "r", "lr"].map((roleKey) => checkRoleVisibility(browser, fixture, roleKey)));
    console.log(JSON.stringify({ fixture, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
