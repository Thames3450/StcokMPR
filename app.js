const SUPABASE_URL = "https://icboatytwqflmrizfuyr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljYm9hdHl0d3FmbG1yaXpmdXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MjQ1NDksImV4cCI6MjA5MzUwMDU0OX0.pQEmMdxHNfFUcMDkHeRy-NbXOeW2kiNHqJMkU7NSHbk";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (selector) => document.querySelector(selector);

const state = {
  currentUser: null,
  parts: [],
  history: [],
  departments: [],
  locations: [],
  masterOptions: [],
  users: [],
  procurement: [],
  activePurchaseFlow: "",
  editingOptionId: null,
  receiveCart: [],
  issueCart: [],
  scannerBuffer: "",
  scannerLastTime: 0,
  searchTimeout: null,
  activeCategory: { parts: "All" },
  cameraMode: null,
  cameraReader: null,
  cameraControls: null,
  cameraBusy: false
};


/* =========================================================
   IMAGE HELPERS
========================================================= */
function getPartImageSrc(part = {}) {
  return (
    part.image_path ||
    part.image_url ||
    part.image ||
    part.photo_url ||
    part.picture ||
    ""
  );
}

function renderImageOrBox(src, altText = "part") {
  if (!src) return "📦";
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(altText)}" loading="lazy" />`;
}

function compressImageFileToDataUrl(file, maxSize = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");

    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        let { width, height } = img;

        if (width > maxSize || height > maxSize) {
          if (width >= height) {
            height = Math.round(height * (maxSize / width));
            width = maxSize;
          } else {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      img.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function bindImagePreview(fileInputId, hiddenInputId, previewId) {
  const fileInput = document.getElementById(fileInputId);
  const hiddenInput = document.getElementById(hiddenInputId);
  const preview = document.getElementById(previewId);

  if (!fileInput || !hiddenInput || !preview) return;
  if (fileInput.dataset.bound === "1") return;

  fileInput.dataset.bound = "1";

  fileInput.addEventListener("change", async function () {
    const file = this.files && this.files[0];

    if (!file) {
      hiddenInput.value = "";
      setImagePreview(previewId, "");
      return;
    }

    if (!file.type.startsWith("image/")) {
      showToast("กรุณาเลือกไฟล์รูปภาพเท่านั้น", "warn");
      this.value = "";
      hiddenInput.value = "";
      setImagePreview(previewId, "");
      return;
    }

    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      hiddenInput.value = dataUrl;
      setImagePreview(previewId, dataUrl);
    } catch (err) {
      console.error(err);
      showToast("แสดงตัวอย่างรูปไม่สำเร็จ", "error");
    }
  });
}

function setImagePreview(previewId, imagePath) {
  const preview = document.getElementById(previewId);
  if (!preview) return;

  if (!imagePath) {
    preview.classList.add("empty");
    preview.innerHTML = "ยังไม่มีรูป";
    return;
  }

  preview.classList.remove("empty");
  preview.innerHTML = `<img src="${escapeHtml(imagePath)}" alt="preview" />`;
}

function initPartImageUploaders() {
  bindImagePreview("newPartImageFile", "newPartImagePath", "newPartImagePreview");
}

document.addEventListener("DOMContentLoaded", initPartImageUploaders);


document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindNavigation();
  bindEvents();
  bindScannerListener();
  await bootAuth();
}

function on(selector, event, handler) {
  const el = $(selector);
  if (el) el.addEventListener(event, handler);
}


/* =========================================================
   ROLE PERMISSION SYSTEM
   admin      = จัดการได้ทุกอย่าง
   purchasing = จัดซื้อ / ดูข้อมูล / อัปเดตสถานะจัดซื้อ แต่ห้ามแก้ไขคลัง และไม่เห็นเบิก/รับเข้า
   user       = ค้นหาอะไหล่ / เบิกสินค้า / ดูประวัติการเบิกของตัวเอง
========================================================= */
const ROLE_RULES = {
  admin: {
    defaultSection: "dashboardSection",
    sections: [
      "dashboardSection",
      "partsSection",
      "receiveSection",
      "issueSection",
      "purchaseSection",
      "topIssueSection",
      "historySection",
      "settingsSection"
    ]
  },
  purchasing: {
    defaultSection: "purchaseSection",
    sections: [
      "dashboardSection",
      "partsSection",
      "purchaseSection",
      "topIssueSection",
      "historySection"
    ]
  },
  user: {
    defaultSection: "issueSection",
    sections: [
      "partsSection",
      "issueSection",
      "historySection"
    ]
  }
};

function getCurrentRole() {
  return String(state.currentUser?.role || "user").trim().toLowerCase();
}

function getRoleRule() {
  return ROLE_RULES[getCurrentRole()] || ROLE_RULES.user;
}

function canAccessSection(sectionId) {
  return getRoleRule().sections.includes(sectionId);
}

function getDefaultSectionForRole() {
  return getRoleRule().defaultSection || "partsSection";
}

function isAdmin() { return getCurrentRole() === "admin"; }
function isPurchasing() { return getCurrentRole() === "purchasing"; }
function isUser() { return getCurrentRole() === "user"; }
function canEditParts() { return isAdmin(); }
function canReceiveStock() { return isAdmin(); }
function canIssueStock() { return isAdmin() || isUser(); }
function canManageProcurement() { return isAdmin() || isPurchasing(); }
function canViewAllHistory() { return isAdmin() || isPurchasing(); }

function getVisibleHistoryRows() {
  if (canViewAllHistory()) return state.history || [];

  const employeeCode = String(state.currentUser?.employee_code || "").trim();
  return (state.history || []).filter((h) => {
    const isIssue = String(h.txn_type || "").toUpperCase() === "OUT";
    const isMine = String(h.employee_id || "").trim() === employeeCode;
    return isIssue && isMine;
  });
}

function applyRoleAccessUI() {
  const role = getCurrentRole();
  document.body.classList.remove("role-admin", "role-purchasing", "role-user");
  document.body.classList.add(`role-${role}`);

  document.querySelectorAll(".nav-btn[data-section]").forEach((btn) => {
    const sectionId = btn.dataset.section;
    btn.classList.toggle("role-hidden", !canAccessSection(sectionId));
  });

  document.querySelectorAll(".main > .section").forEach((section) => {
    const sectionId = section.id;
    if (!canAccessSection(sectionId)) {
      section.classList.remove("active");
      section.style.display = "none";
    }
  });

  ["#openAddPartBtn", "#openReceiveNewPartBtn", "#importPartsBtn", "#excelFileInput"].forEach((selector) => {
    const el = document.querySelector(selector);
    if (el) el.classList.toggle("role-hidden", !canEditParts());
  });

  const receiveNav = document.querySelector('[data-section="receiveSection"]');
  if (receiveNav) receiveNav.classList.toggle("role-hidden", !canReceiveStock());

  const issueNav = document.querySelector('[data-section="issueSection"]');
  if (issueNav) issueNav.classList.toggle("role-hidden", !canIssueStock());

  const purchaseNav = document.querySelector('[data-section="purchaseSection"]');
  if (purchaseNav) purchaseNav.classList.toggle("role-hidden", !canManageProcurement());

  const settingsNav = document.querySelector('[data-section="settingsSection"]');
  if (settingsNav) settingsNav.classList.toggle("role-hidden", !isAdmin());

  if (document.querySelector("#settingsSection")) {
    document.querySelector("#settingsSection").classList.toggle("role-hidden", !isAdmin());
  }

  const currentSection = document.querySelector(".main > .section.active");
  if (currentSection && !canAccessSection(currentSection.id) && typeof window.showSection === "function") {
    window.showSection(getDefaultSectionForRole());
  }
}

function bindNavigation() {
  const navButtons = document.querySelectorAll(".nav-btn[data-section]");
  const sections = document.querySelectorAll(".main > .section");

  function showSection(sectionId) {
    if (!canAccessSection(sectionId)) {
      showToast("คุณไม่มีสิทธิ์เข้าหน้านี้", "error");
      sectionId = getDefaultSectionForRole();
    }

    navButtons.forEach((b) => b.classList.remove("active"));

    const activeBtn = document.querySelector(`.nav-btn[data-section="${sectionId}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    sections.forEach((section) => {
      section.classList.remove("active");
      section.style.display = "none";
    });

    const target = document.getElementById(sectionId);
    if (target) {
      target.classList.add("active");
      target.style.display = "block";
    }

    const title = document.getElementById("pageTitle");
    if (title && activeBtn) {
      title.textContent = activeBtn.textContent
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27ff]/g, "")
        .trim();
    }

    if (sectionId === "partsSection") renderPOSGrids();
    if (sectionId === "historySection") loadHistory().then(renderHistory);
    if (sectionId === "purchaseSection") renderPurchasePage();
    if (sectionId === "topIssueSection") renderTopIssuePage();
    if (sectionId === "settingsSection") renderSettings();

    closeMobileMenuAfterSelect();
  }

  window.showSection = showSection;

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => showSection(btn.dataset.section));
  });

  showSection(getDefaultSectionForRole());
}

function bindEvents() {
  on("#loginBtn", "click", loginUser);
  on("#loginEmployeeCode", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); loginUser(); } });
  on("#logoutBtn", "click", logoutUser);
  on("#mobileMenuToggle", "click", toggleMobileMenu);
  on("#refreshDashboardBtn", "click", refreshAll);
  on("#aiGoPurchaseBtn", "click", () => {
    if (typeof canManageProcurement === "function" && !canManageProcurement()) {
      return showToast("สิทธิ์นี้ไม่สามารถเข้าหน้าจัดซื้อได้", "warn");
    }

    if (typeof window.showSection === "function") {
      window.showSection("purchaseSection");
    } else {
      document.querySelector('[data-section="purchaseSection"]')?.click();
    }
  });

  on("#partsSearch", "input", () => {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(() => {
      if ($("#stockSearchInput")) $("#stockSearchInput").value = $("#partsSearch").value;
      renderPOSGrids();
    }, 180);
  });

  ["#stockSearchInput", "#departmentFilter", "#locationFilter", "#statusFilter"].forEach((id) => {
    on(id, "input", renderPOSGrids);
    on(id, "change", renderPOSGrids);
  });

  on("#openAddPartBtn", "click", () => openAddPartModal());
  on("#openReceiveNewPartBtn", "click", () => openAddPartModal());
  on("#closeAddPartModalBtn", "click", closeAddPartModal);
  on("#cancelAddPartBtn", "click", closeAddPartModal);
  on("#addPartForm", "submit", handleAddNewPartSubmit);
  on("#machineCompatSearch", "input", () => renderCompatibleMachineChecks(getSelectedCompatibleMachines()));

  on("#importPartsBtn", "click", () => {
    if (!canEditParts()) return showToast("สิทธิ์นี้ไม่สามารถ Import หรือแก้ไขอะไหล่ในคลังได้", "error");
    $("#excelFileInput").click();
  });
  on("#excelFileInput", "change", importPartsFromFile);
  on("#exportPartsBtn", "click", exportAllPartsToExcel);
  on("#exportLowStockBtn", "click", exportLowStockToExcel);
  on("#exportHistoryBtn", "click", exportAllHistoryToExcel);
  on("#refreshHistoryBtn", "click", () => loadHistory().then(renderHistory));

  on("#receiveSearchInput", "input", handleReceiveLiveSearch);
  on("#receiveSearchInput", "keydown", handleReceiveEnterScan);
  on("#issueSearchInput", "input", handleIssueLiveSearch);
  on("#issueSearchInput", "keydown", handleIssueEnterScan);

  on("#openReceiveCameraBtn", "click", () => openCameraScanner("receive"));
  on("#openIssueCameraBtn", "click", () => openCameraScanner("issue"));
  on("#closeCameraScannerBtn", "click", closeCameraScanner);
  on("#restartCameraScannerBtn", "click", restartCameraScanner);

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#receiveSearchInput") && !e.target.closest("#receiveSearchResults")) $("#receiveSearchResults")?.classList.add("hidden");
    if (!e.target.closest("#issueSearchInput") && !e.target.closest("#issueSearchResults")) $("#issueSearchResults")?.classList.add("hidden");
  });
on("#receiveSearchResults", "click", (e) => {
  const addBtn = e.target.closest("[data-add-prefill]");
  if (addBtn) {
    openAddPartModal(addBtn.dataset.addPrefill || "");
    return;
  }

  const row = e.target.closest("[data-stock-balance-id]");
  if (!row) return;

  selectReceiveSearchResult(row.dataset.stockBalanceId);
});

on("#issueSearchResults", "click", (e) => {
  const row = e.target.closest("[data-stock-balance-id]");
  if (!row) return;

  selectIssueSearchResult(row.dataset.stockBalanceId);
});
  on("#receiveDetailedCartList", "click", (e) => onCartAction(e, "receive"));
  on("#issueDetailedCartList", "click", (e) => onCartAction(e, "issue"));
  on("#clearReceiveCartBtn", "click", () => { state.receiveCart = []; renderReceiveCart(); });
  on("#clearIssueCartBtn", "click", () => { state.issueCart = []; renderIssueCart(); });
  on("#confirmReceiveBtn", "click", confirmReceiveAll);
  on("#confirmIssueBtn", "click", confirmIssueAll);

  on("#exportPurchaseBtn", "click", exportPurchaseToExcel);
  on("#refreshPurchaseBtn", "click", refreshAll);
 ["#purchaseSearchInput", "#purchaseDepartmentFilter", "#purchaseLocationFilter", "#purchaseStatusFilter", "#purchaseWorkflowFilter"].forEach((id) => {
  on(id, "input", renderPurchasePage);
  on(id, "change", renderPurchasePage);
});

  on("#exportTopIssueBtn", "click", exportTopIssueToExcel);
  on("#refreshTopIssueBtn", "click", () => loadHistory().then(() => { renderTopIssuePage(); showToast("รีเฟรชรายงานเบิกเยอะแล้ว", "success"); }));
  ["#topIssueSearchInput", "#topIssueLimitFilter", "#topIssueSortFilter", "#topIssueMonthPicker"].forEach((id) => {
    on(id, "input", renderTopIssuePage);
    on(id, "change", renderTopIssuePage);
  });

  on("#saveDeptBtn", "click", saveDepartment);
  on("#saveLocBtn", "click", saveLocation);
  on("#clearLocBtn", "click", clearLocationForm);
  on("#saveUserBtn", "click", saveUser);
  on("#clearUserBtn", "click", clearUserForm);
  on("#saveOptionBtn", "click", saveMasterOption);
  on("#clearOptionBtn", "click", clearOptionForm);
  on("#optionType", "change", renderOptionsManager);

  on("#procurementForm", "submit", saveProcurementStatus);
on("#closeProcurementModalBtn", "click", closeProcurementModal);
on("#cancelProcurementBtn", "click", closeProcurementModal);

on("#purchaseTableBody", "click", (e) => {
  const btn = e.target.closest("[data-proc-edit]");
  if (!btn) return;
  openProcurementModal(btn.dataset.procEdit);
});

document.querySelectorAll(".purchase-flow-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.activePurchaseFlow = btn.dataset.flowFilter || "";
    $("#purchaseWorkflowFilter").value = state.activePurchaseFlow;
    renderPurchasePage();
  });
});
}

function toggleMobileMenu() {
  const sidebar = document.querySelector(".sidebar");
  const btn = document.querySelector("#mobileMenuToggle");
  if (!sidebar || !btn) return;
  sidebar.classList.toggle("mobile-menu-open");
  btn.textContent = sidebar.classList.contains("mobile-menu-open") ? "× ปิดเมนู" : "☰ เมนู";
}

function closeMobileMenuAfterSelect() {
  if (window.innerWidth > 760) return;
  const sidebar = document.querySelector(".sidebar");
  const btn = document.querySelector("#mobileMenuToggle");
  if (!sidebar || !btn) return;
  sidebar.classList.remove("mobile-menu-open");
  btn.textContent = "☰ เมนู";
}

async function bootAuth() {
  const saved = localStorage.getItem("coresys_user");
  if (saved) {
    try {
      state.currentUser = JSON.parse(saved);
      applyCurrentUser();
      await refreshAll();
      return;
    } catch (_) { localStorage.removeItem("coresys_user"); }
  }
  showLoginOverlay();
}

function showLoginOverlay() { $("#loginOverlay").style.display = "flex"; }
function hideLoginOverlay() { $("#loginOverlay").style.display = "none"; }
function showAppShell() { $("#appShell").classList.remove("app-hidden"); }
function hideAppShell() { $("#appShell").classList.add("app-hidden"); }

async function loginUser() {
  const code = $("#loginEmployeeCode").value.trim();
  if (!code) return showToast("กรุณากรอกรหัสพนักงาน", "warn");
  const { data, error } = await sb.from("users").select("*").eq("employee_code", code).eq("is_active", true).maybeSingle();
  if (error) return showToast(error.message, "error");
  if (!data) return showToast("ไม่พบรหัสพนักงานนี้ในระบบ", "error");
  state.currentUser = data;
  localStorage.setItem("coresys_user", JSON.stringify(data));
  $("#loginEmployeeCode").value = "";
  applyCurrentUser();
  await refreshAll();
  showToast(`ยินดีต้อนรับ, ${data.full_name}`, "success");
}

function logoutUser() {
  localStorage.removeItem("coresys_user");
  state.currentUser = null;
  state.receiveCart = [];
  state.issueCart = [];
  hideAppShell();
  showLoginOverlay();
  showToast("ออกจากระบบแล้ว", "success");
}

function applyCurrentUser() {
  const user = state.currentUser;
  if (!user) return;

  $("#loginUserInfo").textContent = `${user.full_name} - ${String(user.role || "user").toUpperCase()}`;

  if ($("#receiveEmployeeName")) $("#receiveEmployeeName").value = user.full_name || "";
  if ($("#receiveEmployeeId")) $("#receiveEmployeeId").value = user.employee_code || "";

  if ($("#issueEmployeeName")) $("#issueEmployeeName").value = user.full_name || "";
  if ($("#issueEmployeeId")) $("#issueEmployeeId").value = user.employee_code || "";
  if ($("#issueDepartment")) $("#issueDepartment").value = user.department_code || "";

  showAppShell();
  hideLoginOverlay();

  applyRoleAccessUI();

  const currentSection = document.querySelector(".main > .section.active");
  if (!currentSection || !canAccessSection(currentSection.id)) {
    window.showSection?.(getDefaultSectionForRole());
  }
}

async function refreshAll() {
  await Promise.all([
    loadDepartments(),
    loadLocations(),
    loadMasterOptions(),
    loadUsers(),
    loadParts(),
    loadHistory(),
    loadProcurementTracking()
  ]);

  renderDashboard();
  renderPOSGrids();
  renderReceiveCart();
  renderIssueCart();
  renderPurchasePage();
  renderTopIssuePage();
  renderHistory();
  renderSettings();
  renderStockLocationDropdowns();
  applyRoleAccessUI();
}

async function loadDepartments() {
  const { data, error } = await sb.from("departments").select("*").eq("is_active", true).order("code");
  if (error) return showToast(error.message, "error");
  state.departments = data || [];
}

async function loadLocations() {
  const { data, error } = await sb
    .from("stock_locations")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    showToast("โหลดจุดเก็บสต็อกไม่สำเร็จ: " + error.message, "error");
    state.locations = [];
    return;
  }

  state.locations = data || [];
  renderStockLocationDropdowns();
}

function getStockLocationNames() {
  const fromLocations = (state.locations || [])
    .map((x) => x.name)
    .filter(Boolean);

  const fromParts = (state.parts || [])
    .map((p) => p.stock_location_name)
    .filter(Boolean);

  return [...new Set([...fromLocations, ...fromParts])]
    .map((x) => String(x).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "th"));
}

function fillSelectOptions(el, options, placeholder, keepCurrent = true) {
  if (!el) return;

  const currentValue = keepCurrent ? el.value : "";

  el.innerHTML = `
    <option value="">${escapeHtml(placeholder)}</option>
    ${options
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join("")}
  `;

  if (currentValue && options.includes(currentValue)) {
    el.value = currentValue;
  }
}

function renderStockLocationDropdowns() {
  const locations = getStockLocationNames();

  fillSelectOptions($("#newPartStockLocation"), locations, "เลือกจุดเก็บสต็อก");
  fillSelectOptions($("#locationFilter"), locations, "ทุกจุดเก็บ");
  fillSelectOptions($("#purchaseLocationFilter"), locations, "ทุกจุดเก็บ");

  if ($("#locationDatalist")) {
    $("#locationDatalist").innerHTML = locations
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join("");
  }
}

function setStockLocationValue(value = "") {
  const el = $("#newPartStockLocation");
  if (!el) return;

  renderStockLocationDropdowns();

  const locations = getStockLocationNames();
  const fallback = locations.includes("Main MVR/MSR Stock")
    ? "Main MVR/MSR Stock"
    : (locations[0] || "");

  const finalValue = value && locations.includes(value) ? value : fallback;

  if (finalValue) {
    el.value = finalValue;
  }
}

async function loadMasterOptions() {
  const { data, error } = await sb.from("master_options").select("*").eq("is_active", true).order("option_type", { ascending: true }).order("sort_order", { ascending: true }).order("option_label", { ascending: true });
  if (error) { showToast(error.message, "error"); return; }
  state.masterOptions = data || [];
}

async function loadUsers() {
  const { data, error } = await sb
    .from("users")
    .select("*")
    .order("role", { ascending: true })
    .order("employee_code", { ascending: true });

  if (error) {
    console.error(error);
    showToast("โหลดรายชื่อผู้ใช้ไม่สำเร็จ: " + error.message, "error");
    state.users = [];
    return;
  }

  state.users = data || [];
}


function getOptionsByType(type) {
  return state.masterOptions.filter((item) => item.option_type === type && item.is_active).sort((a, b) => {
    const s1 = Number(a.sort_order || 0), s2 = Number(b.sort_order || 0);
    if (s1 !== s2) return s1 - s2;
    return String(a.option_label || "").localeCompare(String(b.option_label || ""));
  });
}
async function loadProcurementTracking() {
  const { data, error } = await sb
    .from("procurement_tracking")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(error);
    state.procurement = [];
    return;
  }

  state.procurement = data || [];
}
async function loadParts() {
  const { data, error } = await sb.from("v_stock_overview").select("*").eq("is_active", true).order("part_name", { ascending: true });
  if (error) return showToast(error.message, "error");
  state.parts = data || [];
}

async function loadHistory() {
  const { data, error } = await sb.from("transactions").select("*").order("created_at", { ascending: false }).limit(5000);
  if (error) return showToast(error.message, "error");
  state.history = data || [];
}

function renderDynamicDropdowns() {
  renderMachineDatalist();
  renderIssueReasonSelect();
  renderCategoryDatalist();
  renderUnitDatalist();
  renderStockLocationDropdowns();
  renderUserDepartmentSelect();
}

function renderMachineDatalist() {
  const el = $("#issueMachineList");
  if (!el) return;
  el.innerHTML = getOptionsByType("machine").map((m) => `<option value="${escapeHtml(m.option_value)}">${escapeHtml(m.option_label)}</option>`).join("");
}

function renderIssueReasonSelect() {
  const el = $("#issueReason");
  if (!el) return;
  const currentValue = el.value;
  el.innerHTML = `<option value="">เลือกเหตุผลการเบิก</option>` + getOptionsByType("issue_reason").map((r) => `<option value="${escapeHtml(r.option_value)}">${escapeHtml(r.option_label)}</option>`).join("");
  el.value = currentValue;
}

function renderCategoryDatalist() {
  const el = $("#categoryDatalist");
  if (!el) return;
  const categories = [...new Set([...getOptionsByType("category").map((x) => x.option_value), ...state.parts.map((p) => p.category).filter(Boolean)])];
  el.innerHTML = categories.map((cat) => `<option value="${escapeHtml(cat)}"></option>`).join("");
}

function renderUnitDatalist() {
  const el = $("#unitDatalist");
  if (!el) return;
  const units = [...new Set([...getOptionsByType("unit").map((x) => x.option_value), ...state.parts.map((p) => p.unit).filter(Boolean)])];
  el.innerHTML = units.map((unit) => `<option value="${escapeHtml(unit)}"></option>`).join("");
}

function renderUserDepartmentSelect() {
  const el = $("#userDepartment");
  if (!el) return;
  const currentValue = el.value || "MVR";
  el.innerHTML = state.departments.map((d) => `<option value="${escapeHtml(d.code)}">${escapeHtml(d.name)} (${escapeHtml(d.code)})</option>`).join("");
  el.value = currentValue;
}

function renderDashboard() {
  if (!$("#metricTotalParts")) return;

  const totalRows = state.parts.length;
  const totalQty = state.parts.reduce((sum, p) => sum + Number(p.qty || 0), 0);
  const lowRows = state.parts.filter((p) => getStockStatus(p).key === "low");
  const outRows = state.parts.filter((p) => getStockStatus(p).key === "out");

  const low = lowRows.length;
  const out = outRows.length;

  const today = new Date().toISOString().slice(0, 10);
  const todayIn = state.history
    .filter((h) => String(h.created_at || "").slice(0, 10) === today && h.txn_type === "IN")
    .reduce((s, h) => s + Number(h.qty || 0), 0);

  const todayOut = state.history
    .filter((h) => String(h.created_at || "").slice(0, 10) === today && h.txn_type === "OUT")
    .reduce((s, h) => s + Number(h.qty || 0), 0);

  const healthyCount = totalRows - low - out;
  const healthPercent = totalRows > 0 ? Math.round((healthyCount / totalRows) * 100) : 100;

  $("#metricTotalParts").textContent = totalRows.toLocaleString();
  $("#metricTotalQty").textContent = totalQty.toLocaleString();
  $("#metricLowStock").textContent = low.toLocaleString();
  $("#metricOutStock").textContent = out.toLocaleString();
  $("#metricTodayIn").textContent = todayIn.toLocaleString();
  $("#metricTodayOut").textContent = todayOut.toLocaleString();

  if ($("#snapshotTodayIn")) $("#snapshotTodayIn").textContent = todayIn.toLocaleString();
  if ($("#snapshotTodayOut")) $("#snapshotTodayOut").textContent = todayOut.toLocaleString();
  if ($("#snapshotNeedOrder")) $("#snapshotNeedOrder").textContent = (low + out).toLocaleString();
  if ($("#snapshotHealth")) $("#snapshotHealth").textContent = `${healthPercent}%`;

  if ($("#dashboardHealthPercent")) $("#dashboardHealthPercent").textContent = `${healthPercent}%`;
  if ($("#dashboardHealthText")) {
    $("#dashboardHealthText").textContent =
      healthPercent >= 90
        ? "สภาพสต็อกโดยรวมดีมาก"
        : healthPercent >= 75
        ? "สภาพสต็อกอยู่ในเกณฑ์ควบคุม"
        : "มีรายการเสี่ยงที่ควรติดตาม";
  }

  if ($("#dashboardHealthFill")) {
    $("#dashboardHealthFill").style.width = `${Math.max(0, Math.min(healthPercent, 100))}%`;
  }

  if ($("#dashboardDateLabel")) {
    const now = new Date();
    $("#dashboardDateLabel").textContent = now.toLocaleString("th-TH", {
      dateStyle: "full",
      timeStyle: "short"
    });
  }

  if ($("#dashboardUserLabel")) {
    $("#dashboardUserLabel").textContent =
      state.currentUser?.full_name || state.currentUser?.employee_code || "System Admin";
  }

  const criticalRows = [...state.parts]
    .filter((p) => ["low", "out"].includes(getStockStatus(p).key))
    .sort((a, b) => {
      const aKey = getStockStatus(a).key;
      const bKey = getStockStatus(b).key;
      const rank = { out: 0, low: 1, normal: 2 };
      return rank[aKey] - rank[bKey] || Number(a.qty || 0) - Number(b.qty || 0);
    })
    .slice(0, 8);

  if ($("#dashboardCriticalList")) {
    $("#dashboardCriticalList").innerHTML =
      criticalRows
        .map((p) => {
          const st = getStockStatus(p);
          const imgSrc = getPartImageSrc(p);
          return `
            <div class="critical-item">
              <div class="critical-item-left">
                <div class="critical-thumb">
                  ${renderImageOrBox(imgSrc, p.part_name || "part")}
                </div>

                <div class="critical-info">
                  <div class="critical-title">${escapeHtml(p.part_name || "-")}</div>
                  <div class="critical-meta">
                    <span>${escapeHtml(p.part_code || "-")}</span>
                    <span>•</span>
                    <span>${escapeHtml(p.model || "-")}</span>
                    <span>•</span>
                    <span>${escapeHtml(p.brand || "-")}</span>
                  </div>
                  <div class="critical-sub">
                    จุดเก็บ: ${escapeHtml(p.stock_location_name || "-")} / ตำแหน่ง: ${escapeHtml(p.shelf_bin || "-")}
                  </div>
                </div>
              </div>

              <div class="critical-item-right">
                <span class="badge ${st.key}">${st.text}</span>
                <div class="critical-qty">คงเหลือ ${numberFormat(p.qty)}</div>
                <div class="critical-order">ควรสั่ง ${numberFormat(suggestOrderQty(p))}</div>
              </div>
            </div>
          `;
        })
        .join("") ||
      `<div class="dashboard-empty">ยังไม่มีรายการ Critical</div>`;
  }

  const recentRows = state.history.slice(0, 8);

  if ($("#dashboardRecentFeed")) {
    $("#dashboardRecentFeed").innerHTML =
      recentRows
        .map((h) => {
          const typeClass = String(h.txn_type || "").toUpperCase() === "IN" ? "in" : "out";
          return `
            <div class="recent-feed-item">
              <div class="recent-feed-icon ${typeClass}">
                ${typeClass === "in" ? "📥" : "📤"}
              </div>

              <div class="recent-feed-content">
                <div class="recent-feed-title">
                  ${safeTxnTypeLabel(h.txn_type)} • ${escapeHtml(h.part_name || "-")}
                </div>
                <div class="recent-feed-meta">
                  รหัส: ${escapeHtml(h.part_code || "-")} • จำนวน: ${numberFormat(h.qty)} • ${escapeHtml(h.employee_name || "-")}
                </div>
                <div class="recent-feed-time">${formatDate(h.created_at)}</div>
              </div>
            </div>
          `;
        })
        .join("") ||
      `<div class="dashboard-empty">ยังไม่มีประวัติการทำรายการ</div>`;
  }

  const deptMap = new Map();

  state.parts.forEach((p) => {
    const deptList =
      Array.isArray(p.used_department_codes) && p.used_department_codes.length
        ? p.used_department_codes
        : String(p.used_departments || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);

    const targets = deptList.length ? deptList : ["ไม่ระบุ"];

    targets.forEach((dept) => {
      if (!deptMap.has(dept)) {
        deptMap.set(dept, {
          dept,
          total: 0,
          low: 0,
          out: 0
        });
      }

      const row = deptMap.get(dept);
      const st = getStockStatus(p);

      row.total += 1;
      if (st.key === "low") row.low += 1;
      if (st.key === "out") row.out += 1;
    });
  });

  const deptRows = [...deptMap.values()].sort((a, b) => (b.low + b.out) - (a.low + a.out));

  if ($("#dashboardDeptRiskBody")) {
    $("#dashboardDeptRiskBody").innerHTML =
      deptRows
        .map((d) => `
          <tr>
            <td><b>${escapeHtml(d.dept)}</b></td>
            <td>${numberFormat(d.total)}</td>
            <td><span class="risk-chip low">${numberFormat(d.low)}</span></td>
            <td><span class="risk-chip out">${numberFormat(d.out)}</span></td>
            <td><b>${numberFormat(d.low + d.out)}</b></td>
          </tr>
        `)
        .join("") ||
      `<tr><td colspan="5">ยังไม่มีข้อมูลแผนก</td></tr>`;
  }

  if (typeof renderAIStockAdvisor === "function") {
    renderAIStockAdvisor();
  }
}

function renderFilters() {
  const currentDept = $("#departmentFilter")?.value || "";

  if ($("#departmentFilter")) {
    $("#departmentFilter").innerHTML =
      `<option value="">ทุกแผนก</option>` +
      state.departments
        .map((d) => `<option value="${escapeHtml(d.code)}">${escapeHtml(d.name)} (${escapeHtml(d.code)})</option>`)
        .join("");
    $("#departmentFilter").value = currentDept;
  }

  renderStockLocationDropdowns();
}

function renderDepartmentChecks(selected = ["MVR", "MSR"]) {
  if (!$("#departmentCheckboxList")) return;
  $("#departmentCheckboxList").innerHTML = state.departments.map((d) => `<label><input type="checkbox" value="${escapeHtml(d.code)}" ${selected.includes(d.code) ? "checked" : ""}>${escapeHtml(d.name)}</label>`).join("");
}

function getFilteredParts() {
  const search = ($("#stockSearchInput")?.value || $("#partsSearch")?.value || "").trim().toLowerCase();
  const dept = $("#departmentFilter")?.value || "";
  const loc = $("#locationFilter")?.value || "";
  const status = $("#statusFilter")?.value || "";
  const cat = state.activeCategory.parts;
  let rows = [...state.parts];
  if (search) rows = rows.filter((p) => [p.barcode, p.part_code, p.part_name, p.model, p.brand, p.category, p.compatible_machines, p.stock_location_name, p.shelf_bin, p.used_departments].join(" ").toLowerCase().includes(search));
  if (dept) rows = rows.filter((p) => Array.isArray(p.used_department_codes) && p.used_department_codes.includes(dept));
  if (loc) rows = rows.filter((p) => p.stock_location_name === loc);
  if (status) rows = rows.filter((p) => getStockStatus(p).key === status);
  if (cat && cat !== "All") rows = rows.filter((p) => (p.category || "ไม่ระบุ") === cat);
  return rows;
}

function renderCategoryPills() {
  const pillsEl = $("#partsCategoryPills");
  const selectEl = $("#partsCategorySelect");

  if (!pillsEl && !selectEl) return;

  const categoryMap = new Map();

  state.parts.forEach((p) => {
    const cat = String(p.category || "").trim() || "ไม่ระบุ";
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
  });

  const allCategories = [
    {
      value: "All",
      label: "ทั้งหมด",
      count: state.parts.length
    },
    ...[...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"))
      .map(([value, count]) => ({
        value,
        label: value,
        count
      }))
  ];

  const active = state.activeCategory.parts || "All";

  const priorityNames = [
    "Solenoid valve",
    "Motor",
    "Cylinder",
    "Sensor",
    "Electrical",
    "Bearing",
    "Switch",
    "PLC",
    "Pipe",
    "Vacuum pad"
  ];

  let quickCategories = [
    allCategories[0],
    ...priorityNames
      .map((name) => allCategories.find((cat) => cat.value.toLowerCase() === name.toLowerCase()))
      .filter(Boolean)
  ];

  allCategories.forEach((cat) => {
    if (quickCategories.length >= 10) return;
    if (!quickCategories.some((x) => x.value === cat.value)) {
      quickCategories.push(cat);
    }
  });

  const activeCategory = allCategories.find((cat) => cat.value === active);
  if (
    activeCategory &&
    !quickCategories.some((cat) => cat.value === activeCategory.value)
  ) {
    quickCategories.push(activeCategory);
  }

  if (selectEl) {
    selectEl.innerHTML = allCategories
      .map((cat) => `
        <option value="${escapeHtml(cat.value)}">
          ${escapeHtml(cat.label)} (${cat.count})
        </option>
      `)
      .join("");

    selectEl.value = active;

    if (selectEl.dataset.bound !== "1") {
      selectEl.dataset.bound = "1";

      selectEl.addEventListener("change", (e) => {
        state.activeCategory.parts = e.target.value || "All";
        renderPOSGrids();
      });
    }
  }

  if (pillsEl) {
    pillsEl.innerHTML = quickCategories
      .map((cat) => `
        <button
          type="button"
          class="cat-pill ${active === cat.value ? "active" : ""}"
          data-cat="${escapeHtml(cat.value)}"
          title="${escapeHtml(cat.label)}"
        >
          <span>${escapeHtml(cat.label)}</span>
        </button>
      `)
      .join("");

    pillsEl.querySelectorAll(".cat-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeCategory.parts = btn.dataset.cat || "All";

        if (selectEl) {
          selectEl.value = state.activeCategory.parts;
        }

        renderPOSGrids();
      });
    });
  }
}

function renderPOSGrids() {
  if (!$("#partsGridContainer")) return;

  renderCategoryPills();

  const rows = getFilteredParts();

  $("#partsGridContainer").innerHTML = rows.map((p) => {
    const st = getStockStatus(p);
    const imgSrc = getPartImageSrc(p);

    return `
      <div class="part-card ${st.key === "out" ? "out-stock" : ""}" data-stock-id="${p.stock_balance_id}">
        <div class="part-icon">
          ${renderImageOrBox(imgSrc, p.part_name || "part")}
          <span class="unit-badge">${escapeHtml(p.unit || "Pcs")}</span>
          ${st.key !== "normal" ? `<span class="status-badge ${st.key}">${st.text}</span>` : ""}
        </div>

        <div class="part-name">${escapeHtml(p.part_name || "")}</div>

        <div class="part-meta">
          <div>${escapeHtml(p.part_code || "-")}</div>
          <div class="part-model-brand-line">
  <span class="part-model-highlight">${escapeHtml(p.model || "-")}</span>
  <span class="part-brand-muted"> / ${escapeHtml(p.brand || "-")}</span>
</div>
          <div>จุดเก็บ: ${escapeHtml(p.stock_location_name || "-")}</div>
        </div>

        <div class="stock-line">Stock: ${numberFormat(p.qty)} / Min: ${numberFormat(p.min_qty)}</div>
      </div>
    `;
  }).join("") || `<div class="card">ไม่พบข้อมูลอะไหล่</div>`;

  document.querySelectorAll(".part-card").forEach((card) => {
    card.onclick = () => openEditPartModal(card.dataset.stockId);
  });
}

function handleReceiveLiveSearch(e) {
  renderSearchDropdown("receive", e.target.value);
}

function handleIssueLiveSearch(e) {
  renderSearchDropdown("issue", e.target.value);
}

function handleReceiveEnterScan(e) {
  if (e.key !== "Enter") return;

  e.preventDefault();

  const q = e.target.value.trim();
  if (!q) return;

  const part = findExactPart(q);

  if (part) {
    addItemToCart("receive", part);
    clearSearch("receive");
  } else {
    showToast("ไม่พบข้อมูล กำลังเปิดหน้าเพิ่มอะไหล่ใหม่", "warn");
    openAddPartModal(q);
  }
}

function handleIssueEnterScan(e) {
  if (e.key !== "Enter") return;

  e.preventDefault();

  const q = e.target.value.trim();
  if (!q) return;

  const part = findExactPart(q);

  if (part) {
    selectIssueSearchResult(part.stock_balance_id);
  } else {
    showToast("ไม่พบสินค้ารหัส/รุ่นนี้", "error");
  }
}

function renderSearchDropdown(type, query) {
  const q = String(query || "").trim().toLowerCase();
  const dropdown = type === "receive" ? $("#receiveSearchResults") : $("#issueSearchResults");

  if (!dropdown) return;

  if (!q) {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
    return;
  }

  const rows = (state.parts || [])
    .filter((p) => {
      const text = [
        p.barcode,
        p.part_code,
        p.part_name,
        p.model,
        p.brand,
        p.category,
        p.compatible_machines,
        p.stock_location_name,
        p.shelf_bin,
        p.used_departments
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(q);
    })
    .slice(0, 12);

  if (!rows.length) {
    dropdown.innerHTML = `
      <div class="search-row">
        <div></div>
        <div>ไม่พบอะไหล่ "${escapeHtml(query)}"</div>
        ${
          type === "receive"
            ? `<button class="btn primary small" type="button" data-add-prefill="${escapeHtml(query)}">+ เพิ่ม</button>`
            : ""
        }
      </div>
    `;

    dropdown.classList.remove("hidden");
    return;
  }

  dropdown.innerHTML = rows
    .map((p) => {
      const st = getStockStatus(p);
      const stockBalanceId = String(p.stock_balance_id || "");

      return `
        <div class="search-row" data-stock-balance-id="${escapeHtml(stockBalanceId)}">
          <div class="search-icon">📦</div>

          <div>
            <b>${escapeHtml(p.part_name || "")}</b><br>
            <small>
              รหัส: ${escapeHtml(p.part_code || "-")} ·
              รุ่น: ${escapeHtml(p.model || "-")} ·
              ใช้กับ: ${escapeHtml(p.compatible_machines || "-")} ·
              จุดเก็บ: ${escapeHtml(p.stock_location_name || "-")}
            </small>
          </div>

          <div class="stock-pill ${st.key === "out" ? "out" : ""}">
            Stock: ${numberFormat(p.qty)}
          </div>
        </div>
      `;
    })
    .join("");

  dropdown.classList.remove("hidden");
}

function findExactPart(text) {
  const q = String(text || "").trim().toLowerCase();

  return (state.parts || []).find((p) => {
    return (
      String(p.barcode || "").trim().toLowerCase() === q ||
      String(p.part_code || "").trim().toLowerCase() === q ||
      String(p.model || "").trim().toLowerCase() === q
    );
  });
}

window.selectReceiveSearchResult = function (stockBalanceId) {
  const part = (state.parts || []).find((p) => String(p.stock_balance_id) === String(stockBalanceId));

  if (!part) {
    return showToast("ไม่พบรายการอะไหล่นี้", "error");
  }

  addItemToCart("receive", part);
  clearSearch("receive");
};

window.selectIssueSearchResult = function (stockBalanceId) {
  const part = (state.parts || []).find((p) => String(p.stock_balance_id) === String(stockBalanceId));

  if (!part) {
    return showToast("ไม่พบรายการอะไหล่นี้", "error");
  }

  if (Number(part.qty || 0) <= 0) {
    return showToast("สินค้าหมดสต็อก ไม่สามารถเบิกได้", "error");
  }

  addItemToCart("issue", part);
  clearSearch("issue");
};

function clearSearch(type) {
  const input = type === "receive" ? $("#receiveSearchInput") : $("#issueSearchInput");
  const dropdown = type === "receive" ? $("#receiveSearchResults") : $("#issueSearchResults");

  if (input) input.value = "";

  if (dropdown) {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
  }
}

function bindScannerListener() {
  document.addEventListener("keydown", async (e) => {
    const active = document.activeElement;
    if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
    const now = Date.now();
    if (now - state.scannerLastTime > 90) state.scannerBuffer = "";
    state.scannerLastTime = now;
    if (e.key === "Enter") {
      const code = state.scannerBuffer.trim();
      state.scannerBuffer = "";
      if (code.length >= 3) { e.preventDefault(); await handleGlobalScan(code); }
      return;
    }
    if (e.key.length === 1) state.scannerBuffer += e.key;
  }, true);
}

async function handleGlobalScan(code) {
  if ($("#loginOverlay").style.display !== "none") { $("#loginEmployeeCode").value = code; loginUser(); return; }
  const part = findExactPart(code);
  if (!part) return showToast(`ไม่พบสินค้ารหัส ${code}`, "error");
  if ($("#receiveSection").classList.contains("active")) { addItemToCart("receive", part); return; }
  if (!$("#issueSection").classList.contains("active")) document.querySelector(`button[data-section="issueSection"]`)?.click();
  if (Number(part.qty || 0) <= 0) return showToast("สต็อกหมด ไม่สามารถเบิกได้", "error");
  addItemToCart("issue", part);
}

function addItemToCart(type, part) {
  const cart = type === "receive" ? state.receiveCart : state.issueCart;
  const existing = cart.find((item) => item.stock_balance_id === part.stock_balance_id);

  if (existing) {
    if (type === "issue" && Number(existing.qty || 0) >= Number(part.qty || 0)) {
      return showToast(`สต็อกมีแค่ ${numberFormat(part.qty)}`, "warn");
    }

    existing.qty += 1;
  } else {
    cart.push({
      stock_balance_id: part.stock_balance_id,
      part_id: part.part_id,
      barcode: part.barcode || "",
      part_code: part.part_code || "",
      part_name: part.part_name || "",
      model: part.model || "",
      brand: part.brand || "",
      compatible_machines: part.compatible_machines || "",
      stock_location_name: part.stock_location_name || "",
      used_departments: part.used_departments || "",
      stock_qty: Number(part.qty || 0),
      unit: part.unit || "Pcs",
      image_path: getPartImageSrc(part),
      qty: 1
    });
  }

  if (type === "receive") renderReceiveCart();
  else renderIssueCart();

  showToast(type === "receive" ? "เพิ่มเข้ารายการรับเข้าแล้ว" : "เพิ่มเข้ารายการเบิกแล้ว", "success");
}

function renderReceiveCart() {
  const box = $("#receiveDetailedCartList");
  if (!box) return;

  box.innerHTML = state.receiveCart.length
    ? renderCartItems(state.receiveCart, "receive")
    : `<div class="cart-empty-state">ยังไม่มีรายการรับเข้า<br>สแกนหรือค้นหาอะไหล่เพื่อเพิ่มรายการ</div>`;

  $("#receiveTotalItems").textContent = state.receiveCart.length;
  $("#receiveTotalQty").textContent = state.receiveCart.reduce((s, x) => s + Number(x.qty || 0), 0);
}

function renderIssueCart() {
  const box = $("#issueDetailedCartList");
  if (!box) return;

  box.innerHTML = state.issueCart.length
    ? renderCartItems(state.issueCart, "issue")
    : `<div class="cart-empty-state">ยังไม่มีรายการเบิก<br>สแกนหรือค้นหาอะไหล่เพื่อเพิ่มรายการ</div>`;

  $("#issueTotalItems").textContent = state.issueCart.length;
  $("#issueTotalQty").textContent = state.issueCart.reduce((s, x) => s + Number(x.qty || 0), 0);
}

function renderCartItems(cart, type) {
  return cart.map((item, idx) => {
    const imgSrc = getPartImageSrc(item);

    return `
      <div class="cart-item">
        <div class="cart-item-img">
          ${renderImageOrBox(imgSrc, item.part_name || "part")}
        </div>

        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.part_name || "-")}</div>
          <div class="cart-item-code">รหัส: ${escapeHtml(item.part_code || item.barcode || "-")}</div>
          <div class="cart-item-code">รุ่น: ${escapeHtml(item.model || "-")} / ${escapeHtml(item.brand || "-")}</div>
          <div class="cart-item-code">${type === "issue" ? `คงเหลือ: ${numberFormat(item.stock_qty)}` : "รับเข้า"}</div>
        </div>

        <div class="cart-item-actions">
          <div class="qty-ctrl">
            <button data-action="minus" data-index="${idx}">−</button>
            <input value="${numberFormat(item.qty)}" readonly>
            <button data-action="plus" data-index="${idx}">+</button>
          </div>

          <button class="del-btn" data-action="del" data-index="${idx}">×</button>
        </div>
      </div>
    `;
  }).join("");
}

function onCartAction(e, type) {
  const btn = e.target.closest("button");
  if (!btn) return;
  const action = btn.dataset.action;
  const index = Number(btn.dataset.index);
  const cart = type === "receive" ? state.receiveCart : state.issueCart;
  const item = cart[index];
  if (!item) return;
  if (action === "del") cart.splice(index, 1);
  else if (action === "plus") {
    if (type === "issue" && Number(item.qty || 0) >= Number(item.stock_qty || 0)) return showToast(`สต็อกมีแค่ ${numberFormat(item.stock_qty)}`, "warn");
    item.qty += 1;
  } else if (action === "minus") {
    if (Number(item.qty || 0) > 1) item.qty -= 1;
    else cart.splice(index, 1);
  }
  if (type === "receive") renderReceiveCart(); else renderIssueCart();
}

async function confirmReceiveAll() {
  if (!canReceiveStock()) return showToast("คุณไม่มีสิทธิ์รับเข้าสินค้า", "error");
  if (!state.receiveCart.length) return showToast("ไม่มีรายการรับเข้า", "warn");
  const ok = await iosConfirm("ยืนยันรับเข้า", `รับสินค้า ${state.receiveCart.length} รายการ เข้าระบบใช่หรือไม่?`);
  if (!ok) return;
  try {
    for (const item of state.receiveCart) {
      const { error } = await sb.rpc("stock_move", { p_txn_type: "IN", p_stock_balance_id: item.stock_balance_id, p_qty: Number(item.qty || 0), p_employee_name: $("#receiveEmployeeName").value || "", p_employee_id: $("#receiveEmployeeId").value || "", p_machine_name: "", p_document_no: $("#receiveDocNo").value || "", p_reason: "Receive Stock", p_remark: $("#receiveRemark").value || "" });
      if (error) throw error;
    }
    state.receiveCart = [];
    $("#receiveDocNo").value = "";
    $("#receiveRemark").value = "";
    await refreshAll();
    applyCurrentUser();
    showToast("รับเข้าเรียบร้อย", "success");
  } catch (err) { showToast(err.message, "error"); }
}

async function confirmIssueAll() {
  if (!canIssueStock()) return showToast("คุณไม่มีสิทธิ์เบิกสินค้า", "error");
  if (!state.issueCart.length) return showToast("ไม่มีรายการเบิก", "warn");
  const employeeName = state.currentUser?.full_name || $("#issueEmployeeName")?.value || "";
  const employeeId = state.currentUser?.employee_code || $("#issueEmployeeId")?.value || "";
  const department = state.currentUser?.department_code || $("#issueDepartment")?.value || "";
  const machineName = ($("#issueMachineName")?.value || "").trim();
  const reason = ($("#issueReason")?.value || "").trim();
  const remark = ($("#issueRemark")?.value || "").trim();
  if (!machineName) return showToast("กรุณากรอกเครื่องจักร", "error");
  if (!reason) return showToast("กรุณาเลือกเหตุผลการเบิก", "error");
  const machineFullText = [department ? `Dept: ${department}` : "", `Machine: ${machineName}`].filter(Boolean).join(" | ");
  const totalQty = state.issueCart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const ok = await iosConfirm("ยืนยันเบิกสินค้า", `ผู้เบิก: ${employeeName}\nรหัสพนักงาน: ${employeeId}\nแผนก: ${department || "-"}\nเครื่องจักร: ${machineName}\nเหตุผล: ${reason}\nจำนวนรายการ: ${state.issueCart.length}\nจำนวนรวม: ${totalQty}\n\nยืนยันการเบิกใช่หรือไม่?`);
  if (!ok) return;
  try {
    for (const item of state.issueCart) {
      const { error } = await sb.rpc("stock_move", { p_txn_type: "OUT", p_stock_balance_id: item.stock_balance_id, p_qty: Number(item.qty || 0), p_employee_name: employeeName, p_employee_id: employeeId, p_machine_name: machineFullText, p_document_no: "", p_reason: reason, p_remark: remark ? `Remark: ${remark}` : "" });
      if (error) throw error;
    }
    state.issueCart = [];
    $("#issueMachineName").value = "";
    $("#issueReason").value = "";
    $("#issueRemark").value = "";
    await refreshAll();
    applyCurrentUser();
    showToast("เบิกสินค้าสำเร็จ", "success");
  } catch (err) { showToast(err.message, "error"); }
}


/* =========================================================
   AUTO PART CODE - MPR NEXT NUMBER FOR ADD PART ONLY
   ทำงานเหมือนเว็บตัวอย่าง แต่เปลี่ยนจาก P เป็น MPR-เลขถัดไป
   - กดเพิ่มอะไหล่: ดูเลข MPR ล่าสุดจาก state.parts ที่โหลดจากฐานข้อมูล
   - แสดงเลขในช่อง Barcode และ รหัสอะไหล่
   - บันทึกเลขเดียวกับที่เห็นในฟอร์ม
========================================================= */

function isAddPartMode() {
  const title = $("#addPartModalTitle")?.textContent || "";
  return title.includes("เพิ่ม");
}

function isAutoPartCodeLoadingValue(value) {
  const v = String(value || "").trim();
  return (
    !v ||
    v === "กำลังสร้างรหัส..." ||
    v === "ระบบจะสร้างตอนบันทึก" ||
    v === "AUTO"
  );
}

function formatMprCode(number) {
  const safeNumber = Math.max(1, parseInt(number, 10) || 1);
  return `MPR-${String(safeNumber).padStart(5, "0")}`;
}

function getMprNumberFromCode(code) {
  const text = String(code || "").trim().toUpperCase();
  const match = text.match(/^MPR-?(\d+)$/);
  if (!match) return 0;

  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? 0 : n;
}

function generateNextMprCodeFromParts(parts = []) {
  let maxNumber = 0;

  (parts || []).forEach((p) => {
    const partCodeNumber = getMprNumberFromCode(p.part_code);
    const barcodeNumber = getMprNumberFromCode(p.barcode);

    if (partCodeNumber > maxNumber) maxNumber = partCodeNumber;
    if (barcodeNumber > maxNumber) maxNumber = barcodeNumber;
  });

  return formatMprCode(maxNumber + 1);
}

/*
   รองรับโค้ดเก่าที่อาจยังเรียก generateNextCode(lastCode)
   ของเดิมเป็น P001 / P002
   ตัวใหม่นี้คืนค่าเป็น MPR-00001 / MPR-00002
*/
function generateNextCode(lastCode) {
  const currentNumber = getMprNumberFromCode(lastCode);
  return formatMprCode(currentNumber + 1);
}

function fillAutoPartCodeForNewPart(prefillBarcode = "") {
  if (!isAddPartMode()) return;

  const barcodeInput = $("#newPartBarcode");
  const codeInput = $("#newPartCode");
  const nextCode = generateNextMprCodeFromParts(state.parts || []);

  if (codeInput) {
    codeInput.readOnly = true;
    codeInput.value = nextCode;
    codeInput.placeholder = "ระบบสร้างรหัส MPR ให้อัตโนมัติ";
    codeInput.title = "รหัสนี้สร้างจากเลข MPR ล่าสุดในฐานข้อมูล";
  }

  if (barcodeInput) {
    barcodeInput.readOnly = false;
    barcodeInput.value = String(prefillBarcode || "").trim() || nextCode;
    barcodeInput.placeholder = "ระบบสร้างบาร์โค้ด MPR ให้อัตโนมัติ";
    barcodeInput.title = "ถ้าไม่ได้สแกนบาร์โค้ด ระบบจะใช้เลขเดียวกับรหัสอะไหล่";
  }
}

async function ensureAutoPartCodeBeforeSave() {
  if (!isAddPartMode()) return;

  const barcodeInput = $("#newPartBarcode");
  const codeInput = $("#newPartCode");

  if (!codeInput) return;

  if (!String(codeInput.value || "").trim()) {
    codeInput.value = generateNextMprCodeFromParts(state.parts || []);
  }

  if (barcodeInput && !String(barcodeInput.value || "").trim()) {
    barcodeInput.value = codeInput.value;
  }
}

window.openAddPartModal = async function(prefill = "") {
  if (!canEditParts()) {
    return showToast("สิทธิ์นี้ไม่สามารถเพิ่มหรือแก้ไขอะไหล่ในคลังได้", "error");
  }

  $("#addPartForm").reset();
  $("#addPartModalTitle").textContent = "เพิ่มอะไหล่";

  fillAutoPartCodeForNewPart(prefill);

  setStockLocationValue("Main MVR/MSR Stock");
  $("#newPartUnit").value = "Pcs";
  $("#newPartQty").value = 0;
  $("#newPartMin").value = 0;
  $("#newPartMax").value = 0;

  if ($("#newPartImagePath")) $("#newPartImagePath").value = "";
  setImagePreview("newPartImagePreview", "");
  initPartImageUploaders();

  if ($("#machineCompatSearch")) $("#machineCompatSearch").value = "";
  renderCompatibleMachineChecks([]);
  renderDepartmentChecks(["MVR", "MSR"]);

  $("#addPartModal").classList.add("active");
};

function openEditPartModal(stockBalanceId) {
  if (!canEditParts()) return openPartReadOnlyModal(stockBalanceId);
  const p = state.parts.find((x) => x.stock_balance_id === stockBalanceId);
  if (!p) return;

  $("#addPartModalTitle").textContent = "แก้ไขอะไหล่";
  $("#newPartBarcode").value = p.barcode || "";
  $("#newPartCode").value = p.part_code || "";
  if ($("#newPartCode")) {
    $("#newPartCode").readOnly = true;
    $("#newPartCode").placeholder = "รหัสอะไหล่เดิม";
  }
  $("#newPartName").value = p.part_name || "";
  $("#newPartModel").value = p.model || "";
  $("#newPartBrand").value = p.brand || "";
  $("#newPartCategory").value = p.category || "";
  $("#newPartUnit").value = p.unit || "Pcs";
  setStockLocationValue(p.stock_location_name || "Main MVR/MSR Stock");
  $("#newPartQty").value = p.qty || 0;
  $("#newPartMin").value = p.min_qty || 0;
  $("#newPartMax").value = p.max_qty || 0;
  $("#newPartShelf").value = p.shelf_bin || "";
  $("#newPartNote").value = p.part_note || "";

  if ($("#newPartImagePath")) $("#newPartImagePath").value = getPartImageSrc(p);
  setImagePreview("newPartImagePreview", getPartImageSrc(p));
  initPartImageUploaders();

  renderDepartmentChecks(p.used_department_codes || ["MVR", "MSR"]);

  if ($("#machineCompatSearch")) $("#machineCompatSearch").value = "";

  renderCompatibleMachineChecks(
    Array.isArray(p.compatible_machine_values) ? p.compatible_machine_values : []
  );

  $("#addPartModal").classList.add("active");
}

function closeAddPartModal() { $("#addPartModal").classList.remove("active"); }

function openPartReadOnlyModal(stockBalanceId) {
  const p = state.parts.find((x) => String(x.stock_balance_id) === String(stockBalanceId));
  if (!p) return;

  document.querySelectorAll(".part-view-overlay").forEach((el) => el.remove());

  const st = getStockStatus(p);
  const imgSrc = getPartImageSrc(p);

  const canIssue =
    typeof canIssueStock === "function"
      ? canIssueStock()
      : String(state.currentUser?.role || "").toLowerCase() !== "purchasing";

  const hasStock = Number(p.qty || 0) > 0;

  const overlay = document.createElement("div");
  overlay.className = "part-view-overlay active";
  overlay.innerHTML = `
    <div class="part-view-box">
      <div class="part-view-head">
        <div>
          <h3>รายละเอียดอะไหล่</h3>
          <div class="muted">
            ${
              canIssue
                ? "ดูข้อมูลอะไหล่ และสามารถเพิ่มเข้ารายการเบิกได้ทันที"
                : "ดูข้อมูลได้ แต่สิทธิ์นี้ไม่สามารถเบิกหรือแก้ไขอะไหล่ได้"
            }
          </div>
        </div>
        <button type="button" class="drawer-close-btn part-view-close">×</button>
      </div>

      <div class="part-view-content">
        <div class="part-view-image ${imgSrc ? "" : "empty"}">
          ${renderImageOrBox(imgSrc, p.part_name || "part")}
        </div>

        <div class="part-view-detail">
          <span class="badge-status ${
            st.key === "out" ? "badge-out" : st.key === "low" ? "badge-low" : "badge-normal"
          }">
            ${escapeHtml(st.text || "ปกติ")}
          </span>

          <h2>${escapeHtml(p.part_name || "-")}</h2>
          <div class="part-view-code">${escapeHtml(p.part_code || "-")}</div>

          <div class="part-view-grid">
            <div><label>รุ่น</label><b>${escapeHtml(p.model || "-")}</b></div>
            <div><label>ยี่ห้อ</label><b>${escapeHtml(p.brand || "-")}</b></div>
            <div><label>หมวดหมู่</label><b>${escapeHtml(p.category || "-")}</b></div>
            <div><label>หน่วย</label><b>${escapeHtml(p.unit || "Pcs")}</b></div>
            <div><label>จุดเก็บ</label><b>${escapeHtml(p.stock_location_name || "-")}</b></div>
            <div><label>ตำแหน่ง</label><b>${escapeHtml(p.shelf_bin || "-")}</b></div>
            <div><label>แผนกที่ใช้</label><b>${escapeHtml(p.used_departments || "-")}</b></div>
            <div><label>ใช้กับเครื่อง</label><b>${escapeHtml(p.compatible_machines || "-")}</b></div>
            <div><label>คงเหลือ</label><b>${numberFormat(p.qty)}</b></div>
            <div><label>Min</label><b>${numberFormat(p.min_qty)}</b></div>
          </div>

          ${
            canIssue
              ? `
                <div class="part-view-actions">
                  <button
                    type="button"
                    class="part-issue-now-btn ${hasStock ? "" : "disabled"}"
                    data-issue-from-detail="${escapeHtml(p.stock_balance_id)}"
                    ${hasStock ? "" : "disabled"}
                  >
                    <span>📤</span>
                    <div>
                      <b>${hasStock ? "เบิกอะไหล่นี้" : "สต็อกหมด"}</b>
                      <small>${hasStock ? "เพิ่มเข้ารายการเบิกและไปหน้าเบิกสินค้า" : "ไม่สามารถเบิกได้ เพราะคงเหลือ 0"}</small>
                    </div>
                  </button>
                </div>
              `
              : ""
          }
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector(".part-view-close")?.addEventListener("click", () => overlay.remove());

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();

    const issueBtn = e.target.closest("[data-issue-from-detail]");
    if (issueBtn && !issueBtn.disabled) {
      issuePartFromReadOnlyDetail(issueBtn.dataset.issueFromDetail);
    }
  });
}

function issuePartFromReadOnlyDetail(stockBalanceId) {
  const part = state.parts.find((x) => String(x.stock_balance_id) === String(stockBalanceId));
  if (!part) return showToast("ไม่พบข้อมูลอะไหล่นี้", "error");

  if (typeof canIssueStock === "function" && !canIssueStock()) {
    return showToast("คุณไม่มีสิทธิ์เบิกสินค้า", "error");
  }

  if (Number(part.qty || 0) <= 0) {
    return showToast("สินค้าหมดสต็อก ไม่สามารถเบิกได้", "error");
  }

  document.querySelectorAll(".part-view-overlay").forEach((el) => el.remove());

  if (typeof window.showSection === "function") {
    window.showSection("issueSection");
  } else {
    document.querySelector('[data-section="issueSection"]')?.click();
  }

  setTimeout(() => {
    addItemToCart("issue", part);

    if ($("#issueSearchInput")) $("#issueSearchInput").value = "";
    if ($("#issueMachineName")) $("#issueMachineName").focus();

    showToast("เพิ่มอะไหล่เข้ารายการเบิกแล้ว กรุณากรอกเครื่องจักรและเหตุผลการเบิก", "success");
  }, 120);
}

async function handleAddNewPartSubmit(e) {
  e.preventDefault();

  if (!canEditParts()) return showToast("สิทธิ์นี้ไม่สามารถบันทึกหรือแก้ไขอะไหล่ในคลังได้", "error");

  const isAddingNewPart = isAddPartMode();

  const depts = [...document.querySelectorAll("#departmentCheckboxList input:checked")].map((x) => x.value);

  if (!depts.length) return showToast("กรุณาเลือกแผนกที่ใช้ร่วมกัน", "warn");

  await ensureAutoPartCodeBeforeSave();

  const payload = {
    p_barcode: $("#newPartBarcode").value.trim() || $("#newPartCode").value.trim(),
    p_part_code: $("#newPartCode").value.trim(),
    p_part_name: $("#newPartName").value.trim(),
    p_model: $("#newPartModel").value.trim(),
    p_brand: $("#newPartBrand").value.trim(),
    p_category: $("#newPartCategory").value.trim(),
    p_unit: $("#newPartUnit").value.trim() || "Pcs",
    p_stock_location: $("#newPartStockLocation").value.trim() || getStockLocationNames()[0] || "Main MVR/MSR Stock",
    p_used_departments: depts.join(","),
    p_shelf_bin: $("#newPartShelf").value.trim(),
    p_qty: toInt($("#newPartQty").value),
    p_min_qty: toInt($("#newPartMin").value),
    p_max_qty: toInt($("#newPartMax").value),
    p_note: $("#newPartNote").value.trim(),
    p_image_path: $("#newPartImagePath")?.value || ""
  };

  if (!payload.p_part_code) return showToast("ระบบยังไม่ได้สร้างรหัสอะไหล่ กรุณาปิดแล้วเปิดฟอร์มเพิ่มใหม่", "warn");
  if (!payload.p_part_name) return showToast("กรุณากรอกชื่ออะไหล่", "warn");

  let savedPartCode = payload.p_part_code;
  let error = null;

  if (isAddingNewPart) {
    // เพิ่มใหม่: ให้ฐานข้อมูลสร้างรหัสจริงตอนบันทึกเท่านั้น
    // ถ้ากดยกเลิกหรือเปิดฟอร์มทิ้งไว้ เลขจะไม่ถูกรันหาย
    const result = await sb.rpc("import_stock_row_auto_code", payload);
    error = result.error;
    savedPartCode = result.data || "";
  } else {
    // แก้ไข: ใช้รหัสเดิม
    if (!payload.p_part_code || isAutoPartCodeLoadingValue(payload.p_part_code)) {
      return showToast("ไม่พบรหัสอะไหล่เดิมสำหรับแก้ไข", "error");
    }

    const result = await sb.rpc("import_stock_row", payload);
    error = result.error;
  }

  if (error) {
    console.error(error);

    if (String(error.message || "").includes("import_stock_row_auto_code")) {
      return showToast("ยังไม่ได้รัน SQL ฟังก์ชันสร้างรหัสอัตโนมัติ กรุณารัน SETUP_SQL.sql ก่อน", "error");
    }

    return showToast(error.message, "error");
  }

  const partId = await getPartIdByPartCode(savedPartCode || payload.p_part_code);
  await savePartCompatibleMachines(partId, getSelectedCompatibleMachines());

  closeAddPartModal();
  await refreshAll();

  showToast(
    isAddingNewPart && savedPartCode
      ? `บันทึกอะไหล่สำเร็จ รหัสใหม่คือ ${savedPartCode}`
      : "บันทึกอะไหล่สำเร็จ",
    "success"
  );
}

function renderCompatibleMachineChecks(selectedValues = []) {
  const box = $("#compatibleMachineChecks");
  if (!box) return;
  const keyword = ($("#machineCompatSearch")?.value || "").trim().toLowerCase();
  const filtered = getOptionsByType("machine").filter((m) => [m.option_value, m.option_label].join(" ").toLowerCase().includes(keyword));
  box.innerHTML = filtered.map((m) => `<label><input type="checkbox" value="${escapeHtml(m.option_value)}" ${selectedValues.includes(m.option_value) ? "checked" : ""}>${escapeHtml(m.option_label)}</label>`).join("") || `<div>ยังไม่มีรายการเครื่องจักรใน Settings</div>`;
}

function getSelectedCompatibleMachines() {
  return [...document.querySelectorAll("#compatibleMachineChecks input:checked")].map((input) => input.value).filter(Boolean);
}

async function getPartIdByPartCode(partCode) {
  if (!partCode) return null;
  const { data, error } = await sb.from("parts").select("id").eq("part_code", partCode).limit(1).maybeSingle();
  if (error) { console.warn("Get part id failed:", error.message); return null; }
  return data?.id || null;
}

async function savePartCompatibleMachines(partId, machineValues) {
  if (!partId) return;
  await sb.from("part_machine_compatibility").delete().eq("part_id", partId);
  const rows = [...new Set(machineValues)].filter(Boolean).map((machine_value) => ({ part_id: partId, machine_value }));
  if (!rows.length) return;
  const { error } = await sb.from("part_machine_compatibility").insert(rows);
  if (error) console.warn("Save compatible machines failed:", error.message);
}

async function importPartsFromFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const ok = await iosConfirm("Import Excel", `ต้องการนำเข้าไฟล์ ${file.name} ใช่หรือไม่?`);
  if (!ok) { e.target.value = ""; return; }
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    let inserted = 0, updated = 0, failed = 0;
    for (const raw of rows) {
      const p = normalizeExcelRow(raw);
      if (!p.part_name || (!p.part_code && !p.barcode)) { failed++; continue; }
      const { data, error } = await sb.rpc("import_stock_row", { p_barcode: p.barcode, p_part_code: p.part_code, p_part_name: p.part_name, p_model: p.model, p_brand: p.brand, p_category: p.category, p_unit: p.unit, p_stock_location: p.stock_location, p_used_departments: p.used_departments, p_shelf_bin: p.shelf_bin, p_qty: p.qty, p_min_qty: p.min_qty, p_max_qty: p.max_qty, p_note: p.note, p_image_path: p.image_path || "" });
      if (error) { console.error("Import error:", raw, error.message); failed++; }
      else {
        const partId = await getPartIdByPartCode(p.part_code);
        if (p.compatible_machines_values.length) await savePartCompatibleMachines(partId, p.compatible_machines_values);
        if (data === "inserted") inserted++; else updated++;
      }
    }
    await refreshAll();
    showToast(`Import สำเร็จ | เพิ่มใหม่ ${inserted} | อัปเดต ${updated} | ข้าม/ผิดพลาด ${failed}`, "success");
  } catch (err) { showToast(err.message, "error"); }
  finally { e.target.value = ""; }
}

function normalizeExcelRow(row) {
  const barcode = pick(row, ["บาร์โค้ด", "Barcode", "barcode", "BarcodeText", "Barcode Text"]);
  const partCode = pick(row, ["รหัสอะไหล่", "Part Code", "PartCode", "PartID", "Code", "code"]);
  const partName = pick(row, ["ชื่ออะไหล่", "Part Name", "PartName", "Name", "name"]);
  const shelf = pick(row, ["ตำแหน่งจัดเก็บ", "Shelf / Bin", "Shelf", "Bin", "Location", "location", "ตำแหน่ง"]);
  const machineText = pick(row, ["ใช้กับเครื่องจักร", "เครื่องจักรที่ใช้", "Compatible Machines", "Compatible Machine", "Machines", "Machine"]);
  return { barcode, part_code: partCode || barcode, part_name: partName, model: pick(row, ["รุ่น", "Model", "model"]), brand: pick(row, ["ยี่ห้อ", "Brand", "brand"]), category: pick(row, ["หมวดหมู่", "Category", "category"]), unit: pick(row, ["หน่วย", "Unit", "unit"]) || "Pcs", stock_location: pick(row, ["Stock Location", "stock_location", "จุดเก็บสต็อก"]) || "Main MVR/MSR Stock", used_departments: pick(row, ["Used Departments", "Departments", "department", "แผนก", "แผนกที่ใช้งาน"]) || "MVR,MSR", shelf_bin: shelf, qty: pickNum(row, ["จำนวนคงเหลือ", "Qty", "qty", "Quantity", "จำนวน"], 0), min_qty: pickNum(row, ["Min Qty", "Min", "min_qty", "จำนวนขั้นต่ำ"], 0), max_qty: pickNum(row, ["Max Qty", "Max", "max_qty", "จำนวนสูงสุด"], 0), compatible_machines_values: machineText.split(/[,，\/|]/).map((x) => x.trim()).filter(Boolean), image_path: pick(row, ["รูป", "รูปอะไหล่", "Image", "Image URL", "image_path", "image_url"]), note: pick(row, ["หมายเหตุ", "Note", "note"]) };
}

function exportAllPartsToExcel() {
  if (isUser()) return showToast("สิทธิ์ User ค้นหาและดูรายการอะไหล่ได้ แต่ไม่สามารถ Export ได้", "warn");
  exportPartsRows(state.parts, "อะไหล่ทั้งหมด");
}
function exportLowStockToExcel() { exportPartsRows(state.parts.filter((p) => ["low", "out"].includes(getStockStatus(p).key)), "อะไหล่ใกล้หมด"); }

function exportPartsRows(rows, filePrefix) {
  if (!rows.length) return showToast("ไม่มีข้อมูลสำหรับส่งออก", "warn");
  const exportRows = rows.map((p, index) => { const st = getStockStatus(p); return { "ลำดับ": index + 1, "สถานะ": st.text, "บาร์โค้ด": p.barcode || "", "รหัสอะไหล่": p.part_code || "", "ชื่ออะไหล่": p.part_name || "", "รุ่น": p.model || "", "ยี่ห้อ": p.brand || "", "หมวดหมู่": p.category || "", "ใช้กับเครื่องจักร": p.compatible_machines || "", "จุดเก็บ": p.stock_location_name || "", "แผนกที่ใช้ร่วมกัน": p.used_departments || "", "ตำแหน่งจัดเก็บ": p.shelf_bin || "", "จำนวนคงเหลือ": Number(p.qty || 0), "หน่วย": p.unit || "Pcs", "Min Qty": Number(p.min_qty || 0), "Max Qty": Number(p.max_qty || 0), "ควรสั่งเพิ่ม": suggestOrderQty(p), "รูปอะไหล่": getPartImageSrc(p) ? "มีรูป" : "",
      "หมายเหตุ": p.part_note || "", "วันที่อัปเดต": formatDate(p.updated_at) }; });
  const ws = XLSX.utils.json_to_sheet(exportRows);
  ws["!cols"] = autoFitWorksheetColumns(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, filePrefix);
  XLSX.writeFileXLSX(wb, `${filePrefix}_${formatDateForFileName()}.xlsx`);
  showToast("ส่งออกไฟล์เรียบร้อย", "success");
}

function exportAllHistoryToExcel() {
  const visibleRows = getVisibleHistoryRows();

  if (!visibleRows.length) return showToast("ไม่มีประวัติสำหรับส่งออก", "warn");
  if (isUser()) return showToast("สิทธิ์ User ดูประวัติได้ แต่ไม่สามารถ Export ประวัติได้", "warn");

  const rows = visibleRows.map((h, index) => ({
    "ลำดับ": index + 1,
    "วันเวลา": formatDate(h.created_at),
    "ประเภท": safeTxnTypeLabel(h.txn_type),
    "เครื่องจักร / แผนก": h.machine_name || "",
    "บาร์โค้ด": h.barcode || "",
    "รหัสอะไหล่": h.part_code || "",
    "ชื่ออะไหล่": h.part_name || "",
    "จำนวน": Number(h.qty || 0),
    "ก่อนทำ": Number(h.before_qty || 0),
    "หลังทำ": Number(h.after_qty || 0),
    "ผู้ทำรายการ": h.employee_name || "",
    "รหัสพนักงาน": h.employee_id || "",
    "เหตุผล": h.reason || "",
    "หมายเหตุ": h.remark || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = autoFitWorksheetColumns(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "ประวัติทั้งหมด");
  XLSX.writeFileXLSX(wb, `ประวัติทั้งหมด_${formatDateForFileName()}.xlsx`);
  showToast("ส่งออกประวัติเรียบร้อย", "success");
}


function renderPurchaseFilters() {
  const currentDept = $("#purchaseDepartmentFilter")?.value || "";

  if ($("#purchaseDepartmentFilter")) {
    $("#purchaseDepartmentFilter").innerHTML =
      `<option value="">ทุกแผนก</option>` +
      state.departments
        .map((d) => `<option value="${escapeHtml(d.code)}">${escapeHtml(d.name)} (${escapeHtml(d.code)})</option>`)
        .join("");
    $("#purchaseDepartmentFilter").value = currentDept;
  }

  renderStockLocationDropdowns();
}
function getProcurementMeta(key = "need_order") {
  const map = {
    need_order: {
      key: "need_order",
      text: "ต้องสั่งซื้อ",
      className: "need_order"
    },
    ordering: {
      key: "ordering",
      text: "กำลังสั่งซื้อ",
      className: "ordering"
    },
    po_open: {
      key: "po_open",
      text: "เปิด PO",
      className: "po_open"
    },
    waiting_delivery: {
      key: "waiting_delivery",
      text: "รอของมาส่ง",
      className: "waiting_delivery"
    },
    received: {
      key: "received",
      text: "รับของ",
      className: "received"
    }
  };

  return map[key] || map.need_order;
}

function getProcurementRow(stockBalanceId) {
  return state.procurement.find((x) => x.stock_balance_id === stockBalanceId) || null;
}

function calcSuggestedOrderQty(p) {
  const qty = Number(p.qty || 0);
  const minQty = Number(p.min_qty || 0);
  const maxQty = Number(p.max_qty || 0);

  if (maxQty > 0) return Math.max(maxQty - qty, 0);
  return Math.max(minQty - qty, 0);
}
function getPurchaseRows() {
  const q = ($("#purchaseSearchInput")?.value || "").trim().toLowerCase();
  const dept = $("#purchaseDepartmentFilter")?.value || "";
  const loc = $("#purchaseLocationFilter")?.value || "";
  const stockFilter = $("#purchaseStatusFilter")?.value || "";
  const flowFilter = $("#purchaseWorkflowFilter")?.value || state.activePurchaseFlow || "";

  const rows = state.parts
    .map((p) => {
      const stockStatus = getStockStatus(p);
      const proc = getProcurementRow(p.stock_balance_id);
      const suggested = calcSuggestedOrderQty(p);
      const procStatusKey = proc?.status || "need_order";

      return {
        ...p,
        stock_status: stockStatus,
        procurement_status: getProcurementMeta(procStatusKey),
        procurement_status_key: procStatusKey,
        qty_to_order: Number(proc?.qty_to_order ?? suggested),
        supplier: proc?.supplier || "",
        po_no: proc?.po_no || "",
        expected_date: proc?.expected_date || "",
        order_note: proc?.order_note || ""
      };
    })
    .filter((p) => {
      const keepBecauseStock = ["out", "low"].includes(p.stock_status.key);
      const keepBecauseProcFlow = ["ordering", "po_open", "waiting_delivery", "received"].includes(
        p.procurement_status_key
      );

      return keepBecauseStock || keepBecauseProcFlow;
    })
    .filter((p) => !dept || (p.used_departments || "").includes(dept))
    .filter((p) => !loc || p.stock_location_name === loc)
    .filter((p) => !stockFilter || p.stock_status.key === stockFilter)
    .filter((p) => !flowFilter || p.procurement_status_key === flowFilter)
    .filter((p) => {
      if (!q) return true;

      const target = [
        p.part_code,
        p.barcode,
        p.part_name,
        p.model,
        p.brand,
        p.stock_location_name,
        p.compatible_machines,
        p.shelf_bin,
        p.supplier,
        p.po_no
      ]
        .join(" ")
        .toLowerCase();

      return target.includes(q);
    })
    .sort((a, b) => {
      const stockRank = { out: 0, low: 1, normal: 2 };
      const flowRank = { need_order: 0, ordering: 1, po_open: 2, waiting_delivery: 3, received: 4 };

      return (
        stockRank[a.stock_status.key] - stockRank[b.stock_status.key] ||
        flowRank[a.procurement_status_key] - flowRank[b.procurement_status_key] ||
        (b.qty_to_order || 0) - (a.qty_to_order || 0)
      );
    });

  return rows;
}

function renderPurchasePage() {
  if (!$("#purchaseTableBody")) return;

  const rows = getPurchaseRows();

  $("#purchaseOutCount").textContent = rows.filter((p) => p.stock_status.key === "out").length.toLocaleString();
  $("#purchaseLowCount").textContent = rows.filter((p) => p.stock_status.key === "low").length.toLocaleString();
  $("#purchaseTotalCount").textContent = rows.length.toLocaleString();
  $("#purchaseSuggestQty").textContent = rows.reduce((sum, p) => sum + Number(p.qty_to_order || 0), 0).toLocaleString();

  const flowCounts = {
    all: rows.length,
    need_order: rows.filter((p) => p.procurement_status_key === "need_order").length,
    ordering: rows.filter((p) => p.procurement_status_key === "ordering").length,
    po_open: rows.filter((p) => p.procurement_status_key === "po_open").length,
    waiting_delivery: rows.filter((p) => p.procurement_status_key === "waiting_delivery").length,
    received: rows.filter((p) => p.procurement_status_key === "received").length
  };

  $("#flowAllCount").textContent = flowCounts.all.toLocaleString();
  $("#flowNeedOrderCount").textContent = flowCounts.need_order.toLocaleString();
  $("#flowOrderingCount").textContent = flowCounts.ordering.toLocaleString();
  $("#flowPOCount").textContent = flowCounts.po_open.toLocaleString();
  $("#flowWaitingCount").textContent = flowCounts.waiting_delivery.toLocaleString();
  $("#flowReceivedCount").textContent = flowCounts.received.toLocaleString();

  document.querySelectorAll(".purchase-flow-card").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.flowFilter || "") === (state.activePurchaseFlow || ""));
  });

  $("#purchaseTableBody").innerHTML =
    rows
      .map((p) => {
        const stock = p.stock_status;
        const flow = p.procurement_status;
        const imgSrc = getPartImageSrc(p);

        return `
          <tr class="purchase-row ${stock.key === "out" ? "purchase-row-out" : stock.key === "low" ? "purchase-row-low" : ""}">
            <td>
              <span class="purchase-stock-badge ${stock.key}">
                ${escapeHtml(stock.text)}
              </span>
            </td>

            <td>
              <span class="purchase-flow-badge ${flow.className}">
                ${escapeHtml(flow.text)}
              </span>
            </td>

            <td>
              <div class="purchase-item-cell">
                <div class="purchase-item-thumb ${imgSrc ? "" : "empty"}">
                  ${
                    imgSrc
                      ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(p.part_name || "part")}" loading="lazy" />`
                      : `📦`
                  }
                </div>

                <div class="purchase-item-info">
                  <b>${escapeHtml(p.part_name || "-")}</b>
                  <small>รหัส: ${escapeHtml(p.part_code || "-")}</small>
                  <small>รุ่น: ${escapeHtml(p.model || "-")} / ยี่ห้อ: ${escapeHtml(p.brand || "-")}</small>
                </div>
              </div>
            </td>

            <td>
              <div class="purchase-meta-stack">
                <b>${escapeHtml(p.stock_location_name || "-")}</b>
                <small>ตำแหน่ง: ${escapeHtml(p.shelf_bin || "-")}</small>
              </div>
            </td>

            <td><span class="qty-pill ${stock.key}">${numberFormat(p.qty)}</span></td>
            <td>${numberFormat(p.min_qty)}</td>
            <td><span class="order-pill">${numberFormat(p.qty_to_order)}</span></td>
            <td><b>${numberFormat(p.qty_to_order)}</b></td>
            <td>${escapeHtml(p.supplier || "-")}</td>
            <td>${escapeHtml(p.po_no || "-")}</td>
            <td>${escapeHtml(p.expected_date || "-")}</td>

            <td>
              <button class="btn small primary-outline" data-proc-edit="${p.stock_balance_id}">
                อัปเดต
              </button>
            </td>
          </tr>
        `;
      })
      .join("") ||
    `<tr>
      <td colspan="12">
        <div class="purchase-empty-state">
          <div class="purchase-empty-icon">🛒</div>
          <div class="purchase-empty-title">ยังไม่มีรายการในเมนูจัดซื้อ</div>
          <div class="purchase-empty-sub">ลองเปลี่ยนตัวกรอง หรือรีเฟรชข้อมูลอีกครั้ง</div>
        </div>
      </td>
    </tr>`;
}
function openProcurementModal(stockBalanceId) {
  if (!canManageProcurement()) return showToast("คุณไม่มีสิทธิ์จัดการสถานะจัดซื้อ", "error");
  const row = getPurchaseRows().find((x) => x.stock_balance_id === stockBalanceId);
  if (!row) return;

  $("#procStockBalanceId").value = row.stock_balance_id || "";
  $("#procPartId").value = row.part_id || "";
  $("#procStatus").value = row.procurement_status_key || "need_order";
  $("#procQtyToOrder").value = Number(row.qty_to_order || 0);
  $("#procSupplier").value = row.supplier || "";
  $("#procPONo").value = row.po_no || "";
  $("#procExpectedDate").value = row.expected_date || "";
  $("#procNote").value = row.order_note || "";

  $("#procPartSummary").innerHTML = `
    <div class="purchase-item-cell">
      <div class="purchase-item-thumb ${getPartImageSrc(row) ? "" : "empty"}">
        ${
          getPartImageSrc(row)
            ? `<img src="${escapeHtml(getPartImageSrc(row))}" alt="${escapeHtml(row.part_name || "part")}" />`
            : "📦"
        }
      </div>
      <div class="purchase-item-info">
        <b>${escapeHtml(row.part_name || "-")}</b>
        <small>รหัส: ${escapeHtml(row.part_code || "-")}</small>
        <small>คงเหลือ: ${numberFormat(row.qty)} / แนะนำให้สั่ง: ${numberFormat(row.qty_to_order)}</small>
      </div>
    </div>
  `;

  $("#procurementModal").classList.add("active");
}

function closeProcurementModal() {
  $("#procurementModal")?.classList.remove("active");
}

async function saveProcurementStatus(e) {
  e.preventDefault();

  if (!canManageProcurement()) return showToast("คุณไม่มีสิทธิ์บันทึกสถานะจัดซื้อ", "error");

  const payload = {
    stock_balance_id: $("#procStockBalanceId").value,
    part_id: $("#procPartId").value,
    status: $("#procStatus").value,
    qty_to_order: Number($("#procQtyToOrder").value || 0),
    supplier: $("#procSupplier").value.trim(),
    po_no: $("#procPONo").value.trim(),
    expected_date: $("#procExpectedDate").value || null,
    order_note: $("#procNote").value.trim(),
    updated_by: state.currentUser?.full_name || "System",
    updated_at: new Date().toISOString()
  };

  const { error } = await sb
    .from("procurement_tracking")
    .upsert(payload, { onConflict: "stock_balance_id" });

  if (error) {
    console.error(error);
    return showToast("บันทึกสถานะจัดซื้อไม่สำเร็จ", "error");
  }

  closeProcurementModal();
  await loadProcurementTracking();
  renderPurchasePage();
  showToast("อัปเดตสถานะจัดซื้อเรียบร้อย", "success");
}

async function exportPurchaseToExcel() {
  const rows = getPurchaseRows();

  if (!rows.length) {
    return showToast("ไม่มีรายการที่ต้องสั่งซื้อสำหรับส่งออก", "warn");
  }

  if (typeof ExcelJS === "undefined") {
    return showToast("ยังไม่ได้โหลด ExcelJS กรุณาเช็ก CDN ใน index.html", "error");
  }

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "CORESYS";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("รายการต้องสั่งซื้อ", {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    worksheet.columns = [
      { header: "รูป", key: "image", width: 14 },
      { header: "สถานะสต็อก", key: "stock_status", width: 14 },
      { header: "สถานะจัดซื้อ", key: "procurement_status", width: 18 },
      { header: "บาร์โค้ด", key: "barcode", width: 18 },
      { header: "รหัสอะไหล่", key: "part_code", width: 18 },
      { header: "ชื่ออะไหล่", key: "part_name", width: 34 },
      { header: "รุ่น", key: "model", width: 24 },
      { header: "ยี่ห้อ", key: "brand", width: 18 },
      { header: "หมวดหมู่", key: "category", width: 16 },
      { header: "ใช้กับเครื่องจักร", key: "compatible_machines", width: 28 },
      { header: "จุดเก็บ", key: "stock_location_name", width: 24 },
      { header: "แผนกที่ใช้", key: "used_departments", width: 18 },
      { header: "ตำแหน่ง", key: "shelf_bin", width: 14 },
      { header: "คงเหลือ", key: "qty", width: 12 },
      { header: "Min", key: "min_qty", width: 10 },
      { header: "Max", key: "max_qty", width: 10 },
      { header: "แนะนำให้สั่ง", key: "suggest_order_qty", width: 14 },
      { header: "จำนวนสั่งจริง", key: "qty_to_order", width: 14 },
      { header: "หน่วย", key: "unit", width: 10 },
      { header: "Supplier", key: "supplier", width: 22 },
      { header: "PO No.", key: "po_no", width: 18 },
      { header: "กำหนดส่ง", key: "expected_date", width: 16 },
      { header: "หมายเหตุจัดซื้อ", key: "order_note", width: 28 },
      { header: "หมายเหตุอะไหล่", key: "part_note", width: 28 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;

    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        color: { argb: "FFFFFF" }
      };

      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: true
      };

      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "1F6FEB" }
      };

      cell.border = {
        top: { style: "thin", color: { argb: "D0D7DE" } },
        left: { style: "thin", color: { argb: "D0D7DE" } },
        bottom: { style: "thin", color: { argb: "D0D7DE" } },
        right: { style: "thin", color: { argb: "D0D7DE" } }
      };
    });

    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      const rowIndex = i + 2;

      const stock = p.stock_status || getStockStatus(p);
      const procurementText =
        p.procurement_status?.text ||
        getProcurementMeta?.(p.procurement_status_key || "need_order")?.text ||
        "ต้องสั่งซื้อ";

      const suggestQty =
        Number(p.suggest_order_qty ?? p.qty_to_order ?? calcSuggestedOrderQty?.(p) ?? 0);

      worksheet.addRow({
        image: "",
        stock_status: stock.text || "",
        procurement_status: procurementText,
        barcode: p.barcode || "",
        part_code: p.part_code || "",
        part_name: p.part_name || "",
        model: p.model || "",
        brand: p.brand || "",
        category: p.category || "",
        compatible_machines: p.compatible_machines || "",
        stock_location_name: p.stock_location_name || "",
        used_departments: p.used_departments || "",
        shelf_bin: p.shelf_bin || "",
        qty: Number(p.qty || 0),
        min_qty: Number(p.min_qty || 0),
        max_qty: Number(p.max_qty || 0),
        suggest_order_qty: suggestQty,
        qty_to_order: Number(p.qty_to_order || suggestQty || 0),
        unit: p.unit || "Pcs",
        supplier: p.supplier || "",
        po_no: p.po_no || "",
        expected_date: p.expected_date || "",
        order_note: p.order_note || "",
        part_note: p.part_note || ""
      });

      const excelRow = worksheet.getRow(rowIndex);
      excelRow.height = 66;

      const fillColor =
        stock.key === "out"
          ? "FDECEC"
          : stock.key === "low"
          ? "FFF4E5"
          : "FFFFFF";

      excelRow.eachCell((cell, colNumber) => {
        cell.alignment = {
          vertical: "middle",
          horizontal: [6, 7, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 24].includes(colNumber)
            ? "left"
            : "center",
          wrapText: true
        };

        cell.border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } }
        };

        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fillColor }
        };
      });

      excelRow.getCell(2).font = {
        bold: true,
        color: {
          argb:
            stock.key === "out"
              ? "B42318"
              : stock.key === "low"
              ? "A05A00"
              : "168A3A"
        }
      };

      excelRow.getCell(14).font = {
        bold: true,
        color: {
          argb:
            stock.key === "out"
              ? "D92D20"
              : stock.key === "low"
              ? "B35A00"
              : "0F172A"
        }
      };

      excelRow.getCell(17).font = {
        bold: true,
        color: { argb: "007AFF" }
      };

      excelRow.getCell(18).font = {
        bold: true,
        color: { argb: "007AFF" }
      };

      const imageSrc = getPartImageSrc(p);
      const imageDataUrl = await convertImageToDataUrlForExcel(imageSrc);

      if (imageDataUrl) {
        const imageId = workbook.addImage({
          base64: imageDataUrl,
          extension: getImageExtensionForExcel(imageDataUrl)
        });

        worksheet.addImage(imageId, {
          tl: { col: 0.18, row: rowIndex - 0.82 },
          ext: { width: 58, height: 58 }
        });
      }
    }

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 24 }
    };

    const buffer = await workbook.xlsx.writeBuffer();

    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

    downloadBlobExcelFile(blob, `รายการต้องสั่งซื้อ_${formatDateForFileName()}.xlsx`);

    showToast("ส่งออกไฟล์รายการต้องสั่งซื้อพร้อมรูปเรียบร้อย", "success");
  } catch (err) {
    console.error(err);
    showToast("ส่งออกไฟล์ไม่สำเร็จ: " + err.message, "error");
  }
}

function downloadBlobExcelFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function getImageExtensionForExcel(dataUrl = "") {
  if (dataUrl.startsWith("data:image/png")) return "png";
  if (dataUrl.startsWith("data:image/jpeg")) return "jpeg";
  if (dataUrl.startsWith("data:image/jpg")) return "jpeg";

  return "png";
}

async function convertImageToDataUrlForExcel(src = "") {
  if (!src) return "";

  if (src.startsWith("data:image")) {
    return src;
  }

  try {
    const res = await fetch(src);
    const blob = await res.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("แปลงรูปไม่สำเร็จ"));

      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("โหลดรูปสำหรับ Export ไม่สำเร็จ:", err);
    return "";
  }
}

function initTopIssueMonthPicker() {
  const picker = $("#topIssueMonthPicker");
  if (!picker || picker.value) return;
  const now = new Date();
  picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getTopIssueRows() {
  const pickerValue = $("#topIssueMonthPicker")?.value || getCurrentMonthValue();
  const search = ($("#topIssueSearchInput")?.value || "").trim().toLowerCase();
  const sortMode = $("#topIssueSortFilter")?.value || "qty_desc";
  const limitMode = $("#topIssueLimitFilter")?.value || "10";
  const monthStart = `${pickerValue}-01`;
  const nextMonthStart = `${getNextMonthValue(pickerValue)}-01`;
  let issueRows = state.history.filter((h) => String(h.txn_type || "").toUpperCase() === "OUT" && String(h.created_at || "") >= monthStart && String(h.created_at || "") < nextMonthStart);
  if (search) issueRows = issueRows.filter((h) => [h.barcode, h.part_code, h.part_name, h.machine_name, h.employee_name, h.employee_id, h.reason, h.remark].join(" ").toLowerCase().includes(search));
  const map = new Map();
  for (const h of issueRows) {
    const key = h.part_code || h.barcode || h.part_name || "UNKNOWN";
    if (!map.has(key)) map.set(key, { part_code: h.part_code || "", barcode: h.barcode || "", part_name: h.part_name || "", total_qty: 0, issue_count: 0, machines: new Set(), last_employee: "", last_date: "", last_reason: "" });
    const item = map.get(key);
    item.total_qty += Number(h.qty || 0);
    item.issue_count += 1;
    if (h.machine_name) item.machines.add(h.machine_name);
    const hDate = String(h.created_at || "");
    if (!item.last_date || hDate > item.last_date) { item.last_date = h.created_at || ""; item.last_employee = h.employee_name || ""; item.last_reason = h.reason || ""; }
  }
  let rows = [...map.values()].map((item) => ({ ...item, machine_list: [...item.machines] }));
  if (sortMode === "qty_desc") rows.sort((a, b) => Number(b.total_qty || 0) - Number(a.total_qty || 0));
  else if (sortMode === "count_desc") rows.sort((a, b) => Number(b.issue_count || 0) - Number(a.issue_count || 0));
  else if (sortMode === "name_asc") rows.sort((a, b) => String(a.part_name || "").localeCompare(String(b.part_name || "")));
  if (limitMode !== "all") rows = rows.slice(0, Number(limitMode));
  return rows;
}

function renderTopIssuePage() {
  if (!$("#topIssueTableBody")) return;
  initTopIssueMonthPicker();
  const rows = getTopIssueRows();
  $("#topIssueSkuCount").textContent = rows.length.toLocaleString();
  $("#topIssueTotalQty").textContent = rows.reduce((sum, r) => sum + Number(r.total_qty || 0), 0).toLocaleString();
  $("#topIssueMaxQty").textContent = (rows.length ? Math.max(...rows.map((r) => Number(r.total_qty || 0))) : 0).toLocaleString();
  $("#topIssueTop10Qty").textContent = rows.slice(0, 10).reduce((sum, r) => sum + Number(r.total_qty || 0), 0).toLocaleString();
  $("#topIssueTableBody").innerHTML = rows.map((r, index) => { const rank = index + 1; const tags = r.machine_list.length ? r.machine_list.slice(0, 6).map((m) => `<span class="badge normal">${escapeHtml(m)}</span>`).join(" ") : "-"; return `<tr><td>#${rank}</td><td><b>${escapeHtml(r.part_code || "")}</b><br><small>${escapeHtml(r.barcode || "")}</small></td><td><b>${escapeHtml(r.part_name || "")}</b><br><small>${escapeHtml(r.last_reason || "")}</small></td><td><b>${numberFormat(r.total_qty)}</b></td><td>${numberFormat(r.issue_count)} ครั้ง</td><td>${tags}</td><td>${escapeHtml(r.last_employee || "")}</td><td>${formatDate(r.last_date)}</td></tr>`; }).join("") || `<tr><td colspan="8">ยังไม่มีประวัติเบิกออกในเดือนนี้</td></tr>`;
}

function exportTopIssueToExcel() {
  const rows = getTopIssueRows();
  if (!rows.length) return showToast("ไม่มีข้อมูลเบิกเยอะสำหรับส่งออก", "warn");
  const monthText = $("#topIssueMonthPicker")?.value || getCurrentMonthValue();
  const exportRows = rows.map((r, index) => ({ "อันดับ": index + 1, "เดือน": monthText, "บาร์โค้ด": r.barcode || "", "รหัสอะไหล่": r.part_code || "", "ชื่ออะไหล่": r.part_name || "", "จำนวนเบิกรวม": Number(r.total_qty || 0), "จำนวนครั้งที่เบิก": Number(r.issue_count || 0), "เครื่องจักร/แผนกที่ใช้": r.machine_list.join(", "), "ผู้เบิกล่าสุด": r.last_employee || "", "วันที่เบิกล่าสุด": formatDate(r.last_date), "เหตุผลล่าสุด": r.last_reason || "" }));
  const ws = XLSX.utils.json_to_sheet(exportRows);
  ws["!cols"] = autoFitWorksheetColumns(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "เบิกเยอะตามเดือน");
  XLSX.writeFileXLSX(wb, `เบิกเยอะตามเดือน_${monthText}_${formatDateForFileName()}.xlsx`);
  showToast("ส่งออกไฟล์รายงานเบิกเยอะเรียบร้อย", "success");
}

function renderHistory() {
  if (!$("#historyTableBody")) return;
  const rows = getVisibleHistoryRows();
  $("#historyTableBody").innerHTML = rows.map((h) => `<tr><td>${formatDate(h.created_at)}</td><td>${safeTxnTypeLabel(h.txn_type)}</td><td>${escapeHtml(h.machine_name || "")}</td><td>${escapeHtml(h.barcode || "")}</td><td>${escapeHtml(h.part_code || "")}</td><td>${escapeHtml(h.part_name || "")}</td><td>${numberFormat(h.qty)}</td><td>${numberFormat(h.before_qty)}</td><td>${numberFormat(h.after_qty)}</td><td>${escapeHtml(h.employee_name || "")}</td><td>${escapeHtml(h.reason || "")}</td><td>${escapeHtml(h.remark || "")}</td></tr>`).join("") || `<tr><td colspan="12">${isUser() ? "ยังไม่มีประวัติการเบิกของคุณ" : "ยังไม่มีประวัติ"}</td></tr>`;
}


async function saveDepartment() {
  const code = $("#deptCode").value.trim().toUpperCase();
  const name = $("#deptName").value.trim();
  if (!code || !name) return showToast("กรุณากรอกรหัสและชื่อแผนก", "warn");
  const { error } = await sb.from("departments").upsert({ code, name, is_active: true }, { onConflict: "code" });
  if (error) return showToast(error.message, "error");
  $("#deptCode").value = "";
  $("#deptName").value = "";
  await refreshAll();
  showToast("บันทึกแผนกสำเร็จ", "success");
}

async function saveLocation() {
  const editingId = ($("#locEditingId")?.value || "").trim();
  const name = ($("#locName")?.value || "").trim();
  const depts = ($("#locDeptCsv")?.value || "").trim() || "MVR,MSR";

  if (!name) return showToast("กรุณากรอกชื่อจุดเก็บ", "warn");

  const payload = {
    name,
    department_codes: depts,
    is_active: true
  };

  let error;

  if (editingId) {
    const result = await sb.from("stock_locations").update(payload).eq("id", editingId);
    error = result.error;
  } else {
    const { data: existing, error: checkError } = await sb
      .from("stock_locations")
      .select("id")
      .ilike("name", name)
      .maybeSingle();

    if (checkError) {
      console.error(checkError);
      return showToast("ตรวจสอบจุดเก็บไม่สำเร็จ: " + checkError.message, "error");
    }

    if (existing?.id) {
      const result = await sb.from("stock_locations").update(payload).eq("id", existing.id);
      error = result.error;
    } else {
      const result = await sb.from("stock_locations").insert(payload);
      error = result.error;
    }
  }

  if (error) {
    console.error(error);
    return showToast("บันทึกจุดเก็บไม่สำเร็จ: " + error.message, "error");
  }

  clearLocationForm();

  await loadLocations();
  renderFilters();
  renderStockLocationDropdowns();
  renderLocationManager();

  showToast("บันทึกจุดเก็บเรียบร้อย และอัปเดต Dropdown แล้ว", "success");
}

function clearLocationForm() {
  if ($("#locEditingId")) $("#locEditingId").value = "";
  if ($("#locName")) $("#locName").value = "";
  if ($("#locDeptCsv")) $("#locDeptCsv").value = "";

  const btn = $("#saveLocBtn");
  if (btn) btn.textContent = "บันทึกจุดเก็บ";
}

function quickSetLocationForm(name, depts) {
  if ($("#locEditingId")) $("#locEditingId").value = "";
  if ($("#locName")) $("#locName").value = name || "";
  if ($("#locDeptCsv")) $("#locDeptCsv").value = depts || "";

  const btn = $("#saveLocBtn");
  if (btn) btn.textContent = "บันทึกจุดเก็บ";
}

function editLocationFromTable(id) {
  const loc = state.locations.find((x) => String(x.id) === String(id));

  if (!loc) return showToast("ไม่พบข้อมูลจุดเก็บนี้", "error");

  if ($("#locEditingId")) $("#locEditingId").value = loc.id || "";
  if ($("#locName")) $("#locName").value = loc.name || "";
  if ($("#locDeptCsv")) $("#locDeptCsv").value = loc.department_codes || "";

  const btn = $("#saveLocBtn");
  if (btn) btn.textContent = "อัปเดตจุดเก็บ";

  showToast("โหลดข้อมูลจุดเก็บเพื่อแก้ไขแล้ว", "info");
}

async function deleteLocationFromTable(id) {
  const loc = state.locations.find((x) => String(x.id) === String(id));

  if (!loc) return showToast("ไม่พบข้อมูลจุดเก็บนี้", "error");

  const usedCount = state.parts.filter(
    (p) => String(p.stock_location_name || "").trim() === String(loc.name || "").trim()
  ).length;

  let message =
    `ต้องการลบจุดเก็บนี้หรือไม่?

` +
    `ชื่อจุดเก็บ: ${loc.name}
` +
    `แผนกที่ใช้ร่วมกัน: ${loc.department_codes || "-"}
`;

  if (usedCount > 0) {
    message += `
มีอะไหล่ที่ใช้งานจุดเก็บนี้อยู่ ${usedCount} รายการ
ระบบจะปิดใช้งานแทนการลบ เพื่อไม่ให้ข้อมูลอะไหล่เดิมเสียหาย`;
  }

  const ok = await iosConfirm("ยืนยันลบจุดเก็บ", message);
  if (!ok) return;

  let error;

  if (usedCount > 0) {
    const result = await sb.from("stock_locations").update({ is_active: false }).eq("id", id);
    error = result.error;
  } else {
    const result = await sb.from("stock_locations").delete().eq("id", id);
    error = result.error;
  }

  if (error) {
    console.error(error);
    return showToast("ลบจุดเก็บไม่สำเร็จ: " + error.message, "error");
  }

  clearLocationForm();

  await loadLocations();
  await loadParts();

  renderFilters();
  renderStockLocationDropdowns();
  renderLocationManager();
  renderPOSGrids();
  renderPurchasePage();

  showToast(
    usedCount > 0
      ? "จุดเก็บนี้ถูกปิดใช้งานแล้ว เพราะยังมีอะไหล่อ้างอิงอยู่"
      : "ลบจุดเก็บเรียบร้อยแล้ว",
    "success"
  );
}

function renderLocationManager() {
  const body = $("#locationTableBody");
  if (!body) return;

  const rows = state.locations || [];

  body.innerHTML =
    rows
      .map((loc) => {
        const usedCount = state.parts.filter(
          (p) => String(p.stock_location_name || "").trim() === String(loc.name || "").trim()
        ).length;

        return `
          <tr>
            <td>
              <b>${escapeHtml(loc.name || "-")}</b>
              <br>
              <small>ใช้อ้างอิงกับอะไหล่ ${numberFormat(usedCount)} รายการ</small>
            </td>

            <td>
              <span class="dept-mini-badge">${escapeHtml(loc.department_codes || "-")}</span>
            </td>

            <td>
              <span class="user-active-badge active">เปิดใช้งาน</span>
            </td>

            <td>
              <div class="location-action-row">
                <button type="button" class="btn secondary small" onclick="editLocationFromTable('${escapeHtml(loc.id || "")}')">แก้ไข</button>
                <button type="button" class="btn delete small" onclick="deleteLocationFromTable('${escapeHtml(loc.id || "")}')">ลบ</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("") ||
    `<tr><td colspan="4">ยังไม่มีจุดเก็บในระบบ</td></tr>`;
}

async function saveUser() {
  if (!isAdmin()) return showToast("เฉพาะ Admin เท่านั้นที่จัดการผู้ใช้งานได้", "error");

  const employee_code = ($("#userCode")?.value || "").trim();
  const full_name = ($("#userName")?.value || "").trim();
  const role = ($("#userRole")?.value || "user").trim();
  const department_code = ($("#userDepartment")?.value || "MVR").trim();

  if (!employee_code || !full_name) return showToast("กรุณากรอกรหัสพนักงานและชื่อผู้ใช้งาน", "warn");
  if (!["admin", "purchasing", "user"].includes(role)) return showToast("สิทธิ์ผู้ใช้งานไม่ถูกต้อง", "error");

  const { error } = await sb
    .from("users")
    .upsert({ employee_code, full_name, role, department_code, is_active: true }, { onConflict: "employee_code" });

  if (error) {
    console.error(error);
    return showToast("บันทึกผู้ใช้ไม่สำเร็จ: " + error.message, "error");
  }

  clearUserForm();
  await loadUsers();
  renderUserManager();
  showToast("บันทึกผู้ใช้และสิทธิ์เรียบร้อย", "success");
}

function getRoleLabel(role) {
  return { admin: "Admin", purchasing: "Purchasing", user: "User" }[String(role || "").toLowerCase()] || "User";
}

function getRoleDescription(role) {
  return {
    admin: "จัดการได้ทุกอย่าง",
    purchasing: "จัดซื้อ / ดูข้อมูล / อัปเดตสถานะจัดซื้อ",
    user: "เบิกสินค้า / ค้นหาอะไหล่ / ดูประวัติของตัวเอง"
  }[String(role || "").toLowerCase()] || "เบิกสินค้า / ค้นหาอะไหล่ / ดูประวัติของตัวเอง";
}

function clearUserForm() {
  if ($("#userEditingCode")) $("#userEditingCode").value = "";
  if ($("#userCode")) {
    $("#userCode").value = "";
    $("#userCode").disabled = false;
  }
  if ($("#userName")) $("#userName").value = "";
  if ($("#userDepartment")) $("#userDepartment").value = "MVR";
  if ($("#userRole")) $("#userRole").value = "user";
  if ($("#saveUserBtn")) $("#saveUserBtn").textContent = "บันทึกผู้ใช้ / สิทธิ์";
}

function editUserFromTable(employeeCode) {
  const user = (state.users || []).find((u) => String(u.employee_code || "") === String(employeeCode || ""));
  if (!user) return showToast("ไม่พบข้อมูลผู้ใช้นี้", "error");

  if ($("#userEditingCode")) $("#userEditingCode").value = user.employee_code || "";
  if ($("#userCode")) {
    $("#userCode").value = user.employee_code || "";
    $("#userCode").disabled = true;
  }
  if ($("#userName")) $("#userName").value = user.full_name || "";
  if ($("#userDepartment")) $("#userDepartment").value = user.department_code || "MVR";
  if ($("#userRole")) $("#userRole").value = user.role || "user";
  if ($("#saveUserBtn")) $("#saveUserBtn").textContent = "อัปเดตผู้ใช้ / สิทธิ์";
  showToast("โหลดข้อมูลผู้ใช้เพื่อแก้ไขแล้ว", "info");
}

async function toggleUserActive(employeeCode, active) {
  if (!isAdmin()) return showToast("เฉพาะ Admin เท่านั้นที่ปิด/เปิดผู้ใช้งานได้", "error");
  if (!employeeCode) return;

  if (state.currentUser && String(state.currentUser.employee_code || "") === String(employeeCode) && active === false) {
    return showToast("ไม่สามารถปิดใช้งานผู้ใช้ที่กำลังล็อกอินอยู่ได้", "warn");
  }

  const { error } = await sb.from("users").update({ is_active: active }).eq("employee_code", employeeCode);
  if (error) {
    console.error(error);
    return showToast("อัปเดตสถานะผู้ใช้ไม่สำเร็จ: " + error.message, "error");
  }

  await loadUsers();
  renderUserManager();
  showToast(active ? "เปิดใช้งานผู้ใช้แล้ว" : "ปิดใช้งานผู้ใช้แล้ว", "success");
}
async function deleteUserFromTable(employeeCode) {
  if (!isAdmin()) return showToast("เฉพาะ Admin เท่านั้นที่ลบผู้ใช้งานได้", "error");
  if (!employeeCode) return;

  if (state.currentUser && String(state.currentUser.employee_code || "") === String(employeeCode)) {
    return showToast("ไม่สามารถลบผู้ใช้ที่กำลังล็อกอินอยู่ได้", "warn");
  }

  const user = (state.users || []).find((u) => String(u.employee_code || "") === String(employeeCode));
  const userName = user?.full_name || employeeCode;

  const ok = await iosConfirm(
    "ลบผู้ใช้งาน",
    `ต้องการลบผู้ใช้งานนี้ออกจากระบบใช่หรือไม่?

รหัสพนักงาน: ${employeeCode}
ชื่อ: ${userName}

หมายเหตุ: ประวัติการเบิกเดิมจะยังคงอยู่ แต่ผู้ใช้นี้จะล็อกอินไม่ได้อีก`
  );

  if (!ok) return;

  const { error } = await sb
    .from("users")
    .delete()
    .eq("employee_code", employeeCode);

  if (error) {
    console.error(error);
    return showToast("ลบผู้ใช้ไม่สำเร็จ: " + error.message, "error");
  }

  clearUserForm();
  await loadUsers();
  renderUserManager();
  showToast("ลบผู้ใช้งานเรียบร้อย", "success");
}


function renderUserManager() {
  const body = $("#userTableBody");
  if (!body) return;

  const rows = state.users || [];
  body.innerHTML = rows.map((u) => {
    const role = String(u.role || "user").toLowerCase();
    const active = u.is_active !== false;
    return `
      <tr>
        <td><b>${escapeHtml(u.employee_code || "-")}</b></td>
        <td>${escapeHtml(u.full_name || "-")}</td>
        <td><span class="dept-mini-badge">${escapeHtml(u.department_code || "-")}</span></td>
        <td>
          <span class="role-badge ${escapeHtml(role)}">${escapeHtml(getRoleLabel(role))}</span><br>
          <small>${escapeHtml(getRoleDescription(role))}</small>
        </td>
        <td><span class="user-active-badge ${active ? "active" : "inactive"}">${active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span></td>
        <td>
          <div class="user-action-row">
            <button type="button" class="btn secondary small" onclick="editUserFromTable('${escapeHtml(u.employee_code || "")}')">แก้ไข</button>
            <button type="button" class="btn ${active ? "delete" : "primary"} small" onclick="toggleUserActive('${escapeHtml(u.employee_code || "")}', ${active ? "false" : "true"})">${active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</button>
            <button type="button" class="btn danger small" onclick="deleteUserFromTable('${escapeHtml(u.employee_code || "")}')">ลบ</button>
          </div>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="6">ยังไม่มีผู้ใช้งานในระบบ</td></tr>`;
}

window.editUserFromTable = editUserFromTable;
window.toggleUserActive = toggleUserActive;
window.deleteUserFromTable = deleteUserFromTable;

function getOptionTypeLabel(type) { return { machine: "เครื่องจักร", issue_reason: "เหตุผลการเบิก", category: "หมวดหมู่อะไหล่", unit: "หน่วยนับ" }[type] || type; }

function renderOptionsManager() {
  const body = $("#optionTableBody");
  if (!body) return;
  const type = $("#optionType")?.value || "machine";
  const rows = getOptionsByType(type);
  body.innerHTML = rows.map((item) => `<tr><td><span class="badge normal">${escapeHtml(getOptionTypeLabel(item.option_type))}</span></td><td>${escapeHtml(item.option_value || "")}</td><td>${escapeHtml(item.option_label || "")}</td><td>${numberFormat(item.sort_order || 0)}</td><td><div class="user-action-row"><button class="btn secondary small" onclick="editMasterOption('${item.id}')">แก้ไข</button> <button class="btn delete small" onclick="deleteMasterOption('${item.id}')">ปิดใช้งาน</button> <button class="btn danger small" onclick="hardDeleteMasterOption('${item.id}')">ลบ</button></div></td></tr>`).join("") || `<tr><td colspan="5">ยังไม่มีตัวเลือกในประเภทนี้</td></tr>`;
}

async function saveMasterOption() {
  const option_type = $("#optionType")?.value || "";
  const option_value = ($("#optionValue")?.value || "").trim();
  const option_label = ($("#optionLabel")?.value || "").trim();
  const sort_order = toInt($("#optionSort")?.value || 0);
  if (!option_type) return showToast("กรุณาเลือกประเภท Dropdown", "warn");
  if (!option_value) return showToast("กรุณากรอกค่าในระบบ", "warn");
  if (!option_label) return showToast("กรุณากรอกชื่อที่แสดง", "warn");
  let error;
  if (state.editingOptionId) {
    ({ error } = await sb.from("master_options").update({ option_type, option_value, option_label, sort_order, is_active: true, updated_at: new Date().toISOString() }).eq("id", state.editingOptionId));
  } else {
    ({ error } = await sb.from("master_options").upsert({ option_type, option_value, option_label, sort_order, is_active: true, updated_at: new Date().toISOString() }, { onConflict: "option_type,option_value" }));
  }
  if (error) return showToast(error.message, "error");
  clearOptionForm();
  await loadMasterOptions();
  renderDynamicDropdowns();
  renderOptionsManager();
  showToast("บันทึก Dropdown สำเร็จ", "success");
}

window.editMasterOption = function(id) {
  const item = state.masterOptions.find((x) => x.id === id);
  if (!item) return;
  state.editingOptionId = id;
  $("#optionType").value = item.option_type || "machine";
  $("#optionValue").value = item.option_value || "";
  $("#optionLabel").value = item.option_label || "";
  $("#optionSort").value = item.sort_order || 0;
  showToast("โหลดข้อมูลเพื่อแก้ไขแล้ว", "success");
};

window.deleteMasterOption = async function(id) {
  const ok = await iosConfirm("ปิดใช้งาน Dropdown", "ต้องการปิดใช้งานตัวเลือกนี้ใช่หรือไม่?");
  if (!ok) return;
  const { error } = await sb.from("master_options").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return showToast(error.message, "error");
  await loadMasterOptions();
  renderDynamicDropdowns();
  renderOptionsManager();
  showToast("ปิดใช้งานตัวเลือกแล้ว", "success");
};
window.hardDeleteMasterOption = async function(id) {
  if (!isAdmin()) return showToast("เฉพาะ Admin เท่านั้นที่ลบ Dropdown ได้", "error");

  const item = (state.masterOptions || []).find((x) => String(x.id) === String(id));
  const label = item ? `${getOptionTypeLabel(item.option_type)}: ${item.option_label || item.option_value || "-"}` : "ตัวเลือกนี้";

  const ok = await iosConfirm(
    "ลบ Dropdown",
    `ต้องการลบ ${label} ออกจากระบบถาวรใช่หรือไม่?

ถ้ายังมีการใช้งานในข้อมูลเก่า ข้อมูลเดิมจะไม่หาย แต่ตัวเลือกนี้จะไม่แสดงใน Dropdown อีก`
  );

  if (!ok) return;

  const { error } = await sb
    .from("master_options")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(error);
    return showToast("ลบ Dropdown ไม่สำเร็จ: " + error.message, "error");
  }

  if (String(state.editingOptionId || "") === String(id)) clearOptionForm();
  await loadMasterOptions();
  renderDynamicDropdowns();
  renderOptionsManager();
  showToast("ลบ Dropdown เรียบร้อย", "success");
};


function clearOptionForm() {
  state.editingOptionId = null;
  if ($("#optionValue")) $("#optionValue").value = "";
  if ($("#optionLabel")) $("#optionLabel").value = "";
  if ($("#optionSort")) $("#optionSort").value = 0;
}

async function openCameraScanner(mode = "issue") {
  state.cameraMode = mode;
  state.cameraBusy = false;
  const title = $("#cameraScannerTitle");
  const status = $("#cameraScannerStatus");
  const modal = $("#cameraScannerModal");
  if (title) title.textContent = mode === "receive" ? "สแกนบาร์โค้ดเพื่อรับเข้า" : "สแกนบาร์โค้ดเพื่อเบิกสินค้า";
  if (status) status.textContent = "กำลังเปิดกล้อง...";
  if (!window.isSecureContext) return showToast("กล้องใช้ได้เมื่อเปิดผ่าน HTTPS เช่น GitHub Pages เท่านั้น", "error");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showToast("Browser นี้ไม่รองรับการเปิดกล้อง", "error");
  if (!window.ZXingBrowser) return showToast("ยังโหลดไลบรารีสแกนบาร์โค้ดไม่สำเร็จ", "error");
  modal.classList.add("active");
  try { await startCameraScanner(); }
  catch (err) { console.error(err); if (status) status.textContent = "เปิดกล้องไม่สำเร็จ"; showToast("เปิดกล้องไม่สำเร็จ กรุณาอนุญาตสิทธิ์กล้อง", "error"); closeCameraScanner(); }
}

async function startCameraScanner() {
  const video = $("#cameraPreview");
  const status = $("#cameraScannerStatus");
  stopCameraScannerOnly();
  state.cameraReader = new ZXingBrowser.BrowserMultiFormatReader();
  state.cameraBusy = false;
  const constraints = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
  if (status) status.textContent = "เปิดกล้องแล้ว กำลังรอสแกน...";
  if (typeof state.cameraReader.decodeFromConstraints === "function") state.cameraControls = await state.cameraReader.decodeFromConstraints(constraints, video, onCameraScanResult);
  else state.cameraControls = await state.cameraReader.decodeFromVideoDevice(undefined, video, onCameraScanResult);
}

function onCameraScanResult(result) {
  if (!result || state.cameraBusy) return;
  const code = result.getText ? result.getText() : String(result.text || "");
  if (!code) return;
  state.cameraBusy = true;
  const status = $("#cameraScannerStatus");
  if (status) status.textContent = `อ่านได้: ${code}`;
  if (navigator.vibrate) navigator.vibrate(120);
  handleCameraBarcode(code);
}

async function handleCameraBarcode(code) {
  const scanCode = String(code || "").trim();
  if (!scanCode) { state.cameraBusy = false; return; }
  const part = findExactPart(scanCode);
  if (state.cameraMode === "receive") {
    closeCameraScanner();
    if (part) { addItemToCart("receive", part); showToast(`สแกนรับเข้า: ${part.part_name}`, "success"); }
    else { showToast("ไม่พบอะไหล่ เปิดหน้าเพิ่มรายการใหม่", "warn"); openAddPartModal(scanCode); }
    return;
  }
  closeCameraScanner();
  if (!part) return showToast(`ไม่พบอะไหล่รหัส ${scanCode}`, "error");
  if (Number(part.qty || 0) <= 0) return showToast("สินค้าหมดสต็อก ไม่สามารถเบิกได้", "error");
  addItemToCart("issue", part);
  showToast(`สแกนเบิก: ${part.part_name}`, "success");
}

async function restartCameraScanner() {
  const status = $("#cameraScannerStatus");
  if (status) status.textContent = "เริ่มสแกนใหม่...";
  state.cameraBusy = false;
  try { await startCameraScanner(); }
  catch (err) { console.error(err); showToast("เริ่มกล้องใหม่ไม่สำเร็จ", "error"); }
}

function closeCameraScanner() {
  stopCameraScannerOnly();
  const modal = $("#cameraScannerModal");
  if (modal) modal.classList.remove("active");
  state.cameraMode = null;
  state.cameraBusy = false;
}

function stopCameraScannerOnly() {
  try { if (state.cameraControls && typeof state.cameraControls.stop === "function") state.cameraControls.stop(); } catch (e) {}
  try { if (state.cameraReader && typeof state.cameraReader.reset === "function") state.cameraReader.reset(); } catch (e) {}
  try { const video = $("#cameraPreview"); if (video && video.srcObject) { video.srcObject.getTracks().forEach((track) => track.stop()); video.srcObject = null; } } catch (e) {}
  state.cameraControls = null;
  state.cameraReader = null;
}

function getStockStatus(p) {
  const qty = Number(p.qty || 0);
  const min = Number(p.min_qty || 0);
  if (qty <= 0) return { key: "out", text: "หมด" };
  if (qty <= min) return { key: "low", text: "ใกล้หมด" };
  return { key: "normal", text: "ปกติ" };
}
function suggestOrderQty(p) { const qty = Number(p.qty || 0), min = Number(p.min_qty || 0), max = Number(p.max_qty || 0); return max > 0 ? Math.max(max - qty, 0) : Math.max(min - qty, 0); }
function iosConfirm(title, message = "") {
  return new Promise((resolve) => {
    // ลบ popup เก่าที่ค้างอยู่ก่อน กันการซ้อนหลายกล่อง
    document.querySelectorAll(".confirm-overlay").forEach((el) => el.remove());

    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";

    const safeTitle = escapeHtml(title || "ยืนยัน");
    const safeMessage = escapeHtml(message || "");

    overlay.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true">
        <div class="confirm-icon">?</div>

        <div class="confirm-content">
          <h3>${safeTitle}</h3>
          <div class="confirm-message">${safeMessage}</div>
        </div>

        <div class="confirm-actions">
          <button type="button" class="btn secondary confirm-cancel">ยกเลิก</button>
          <button type="button" class="btn primary confirm-ok">ตกลง</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add("show");
    });

    const close = (result) => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 160);
    };

    overlay.querySelector(".confirm-cancel").addEventListener("click", () => close(false));
    overlay.querySelector(".confirm-ok").addEventListener("click", () => close(true));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });

    const escHandler = (e) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", escHandler);
        close(false);
      }
    };

    document.addEventListener("keydown", escHandler);
  });
}
function showToast(message, type = "info") {
  showSystemCardAlert({
    type,
    title:
      type === "success"
        ? "SUCCESS"
        : type === "error"
        ? "ERROR"
        : type === "warn"
        ? "WARNING"
        : "INFO",
    message: message || "",
    autoClose: true,
    duration: 1500
  });
}
function showSystemCardAlert({
  type = "info",
  title = "INFO",
  message = "",
  autoClose = true,
  duration = 200
} = {}) {
  document.querySelectorAll(".sys-card-alert-overlay").forEach((el) => el.remove());

  const safeType = ["success", "error", "warn", "info"].includes(type) ? type : "info";

  const iconMap = {
    success: "✓",
    error: "✕",
    warn: "!",
    info: "i"
  };

  const buttonMap = {
    success: "CONTINUE",
    error: "TRY AGAIN",
    warn: "OK",
    info: "OK"
  };

  const overlay = document.createElement("div");
  overlay.className = `sys-card-alert-overlay ${safeType}`;

  overlay.innerHTML = `
    <div class="sys-card-alert-box" role="alertdialog" aria-modal="true">
      <div class="sys-card-alert-icon">${iconMap[safeType]}</div>

      <div class="sys-card-alert-title">${escapeHtml(title)}</div>

      <div class="sys-card-alert-message">
        ${escapeHtml(message || "")}
      </div>

      <button type="button" class="sys-card-alert-btn">
        ${buttonMap[safeType]}
      </button>

      ${
        autoClose
          ? `<div class="sys-card-alert-timer"></div>`
          : ""
      }
    </div>
  `;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add("show");
  });

  const close = () => {
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 180);
  };

  const btn = overlay.querySelector(".sys-card-alert-btn");
  if (btn) btn.addEventListener("click", close);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const escHandler = (e) => {
    if (e.key === "Escape") {
      document.removeEventListener("keydown", escHandler);
      close();
    }
  };

  document.addEventListener("keydown", escHandler);

  if (autoClose) {
    clearTimeout(window.__sysCardAlertTimer);
    window.__sysCardAlertTimer = setTimeout(close, duration);
  }
}

function safeTxnTypeLabel(type) { const t = String(type || "").toUpperCase(); if (t === "IN") return "รับเข้า"; if (t === "OUT") return "เบิกออก"; if (t === "ADJUST") return "ปรับยอด"; return type || "-"; }
function formatDate(value) { if (!value) return ""; const d = new Date(value); if (Number.isNaN(d.getTime())) return value; return d.toLocaleString("th-TH", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function formatDateForFileName(date = new Date()) { const yyyy = date.getFullYear(); const mm = String(date.getMonth() + 1).padStart(2, "0"); const dd = String(date.getDate()).padStart(2, "0"); const hh = String(date.getHours()).padStart(2, "0"); const mi = String(date.getMinutes()).padStart(2, "0"); return `${yyyy}${mm}${dd}_${hh}${mi}`; }
function getCurrentMonthValue() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; }
function getNextMonthValue(monthValue) { const [yyyy, mm] = String(monthValue || getCurrentMonthValue()).split("-").map(Number); const date = new Date(yyyy, mm, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function numberFormat(v) { return Number(v || 0).toLocaleString(); }
function toInt(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }
function pick(row, keys) { for (const key of keys) { if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return String(row[key]).trim(); } return ""; }
function pickNum(row, keys, fallback = 0) { const value = pick(row, keys); if (value === "") return fallback; const n = Number(String(value).replace(/,/g, "")); return Number.isFinite(n) ? n : fallback; }
function autoFitWorksheetColumns(rows) { if (!rows.length) return []; const keys = Object.keys(rows[0]); return keys.map((key) => { let maxLen = String(key).length; rows.forEach((row) => { const value = row[key] == null ? "" : String(row[key]); if (value.length > maxLen) maxLen = value.length; }); return { wch: Math.min(maxLen + 2, 44) }; }); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

/* =========================================================
   IMPORT EXCEL V2 - CLEAR STATUS + ERROR REPORT
   วางท้ายไฟล์ app.js
========================================================= */

function ensureImportStatusModal() {
  if (document.querySelector("#importStatusOverlay")) return;

  const modal = document.createElement("div");
  modal.id = "importStatusOverlay";
  modal.className = "import-status-overlay";
  modal.innerHTML = `
    <div class="import-status-card">
      <div class="import-status-head">
        <div class="import-status-icon" id="importStatusIcon">📤</div>
        <div>
          <div class="import-status-title" id="importStatusTitle">Import Excel</div>
          <div class="import-status-sub" id="importStatusSub">กำลังเตรียมข้อมูล...</div>
        </div>
      </div>

      <div class="import-progress-bar">
        <div class="import-progress-fill" id="importProgressFill"></div>
      </div>

      <div class="import-status-sub" id="importProgressText">0%</div>

      <div class="import-status-list" id="importStatusList"></div>

      <div class="import-status-actions">
        <button id="closeImportStatusBtn" class="btn secondary" type="button">ปิด</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.querySelector("#closeImportStatusBtn").addEventListener("click", () => {
    document.querySelector("#importStatusOverlay").classList.remove("active");
  });
}

function showImportModal(title = "Import Excel", sub = "กำลังเตรียมข้อมูล...") {
  ensureImportStatusModal();

  document.querySelector("#importStatusTitle").textContent = title;
  document.querySelector("#importStatusSub").textContent = sub;
  document.querySelector("#importStatusIcon").textContent = "📤";
  document.querySelector("#importProgressFill").style.width = "0%";
  document.querySelector("#importProgressText").textContent = "0%";
  document.querySelector("#importStatusList").innerHTML = "";

  document.querySelector("#importStatusOverlay").classList.add("active");
}

function updateImportProgress(percent, text) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));

  const fill = document.querySelector("#importProgressFill");
  const label = document.querySelector("#importProgressText");

  if (fill) fill.style.width = `${p}%`;
  if (label) label.textContent = text || `${p}%`;
}

function addImportLog(type, text) {
  const list = document.querySelector("#importStatusList");
  if (!list) return;

  const icon =
    type === "success"
      ? "✅"
      : type === "error"
      ? "❌"
      : "⚠️";

  const row = document.createElement("div");
  row.className = `import-status-row ${type}`;
  row.innerHTML = `<span>${icon}</span><span>${escapeHtml(text)}</span>`;

  list.prepend(row);
}

function pickImportValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }

  return "";
}

function toImportInt(value, fallback = 0) {
  const n = parseInt(String(value ?? "").replace(/,/g, "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeImportRowV2(row, index) {
  const barcode = pickImportValue(row, [
    "บาร์โค้ด",
    "Barcode",
    "barcode",
    "BARCODE"
  ]);

  const partCode = pickImportValue(row, [
    "รหัสอะไหล่",
    "รหัส",
    "Part Code",
    "part_code",
    "Code",
    "code"
  ]);

  const partName = pickImportValue(row, [
    "ชื่ออะไหล่",
    "ชื่อ",
    "Part Name",
    "part_name",
    "Name",
    "name"
  ]);

  const model = pickImportValue(row, [
    "รุ่น",
    "Model",
    "model"
  ]);

  const brand = pickImportValue(row, [
    "ยี่ห้อ",
    "Brand",
    "brand"
  ]);

  const category = pickImportValue(row, [
    "หมวดหมู่",
    "Category",
    "category"
  ]);

  const unit = pickImportValue(row, [
    "หน่วย",
    "Unit",
    "unit"
  ]) || "Pcs";

  const stockLocation = pickImportValue(row, [
    "จุดเก็บ",
    "จุดเก็บสต็อก",
    "Stock Location",
    "stock_location",
    "Location",
    "location"
  ]) || "Main MVR/MSR Stock";

  const usedDepartments = pickImportValue(row, [
    "แผนกที่ใช้",
    "ใช้โดย",
    "Used Departments",
    "used_departments",
    "Department",
    "department"
  ]) || "MVR,MSR";

  const shelfBin = pickImportValue(row, [
    "ตำแหน่ง",
    "ตำแหน่งจัดเก็บ",
    "Shelf",
    "Shelf Bin",
    "shelf_bin",
    "Bin"
  ]);

  const qty = toImportInt(
    pickImportValue(row, [
      "คงเหลือ",
      "จำนวน",
      "Qty",
      "qty",
      "Stock",
      "stock"
    ]),
    0
  );

  const minQty = toImportInt(
    pickImportValue(row, [
      "Min",
      "Min Qty",
      "min_qty",
      "ขั้นต่ำ",
      "จำนวนขั้นต่ำ"
    ]),
    0
  );

  const maxQty = toImportInt(
    pickImportValue(row, [
      "Max",
      "Max Qty",
      "max_qty",
      "สูงสุด",
      "จำนวนสูงสุด"
    ]),
    0
  );

  const note = pickImportValue(row, [
    "หมายเหตุ",
    "Note",
    "note"
  ]);

  const imagePath = pickImportValue(row, [
    "รูป",
    "รูปอะไหล่",
    "Image",
    "Image URL",
    "image",
    "image_path",
    "image_url"
  ]);

  const compatibleMachines = pickImportValue(row, [
    "ใช้กับเครื่อง",
    "ใช้กับเครื่องจักร",
    "Compatible Machines",
    "compatible_machines",
    "Machine",
    "machine"
  ]);

  return {
    rowNumber: index + 2,
    barcode,
    part_code: partCode || barcode,
    part_name: partName,
    model,
    brand,
    category,
    unit,
    stock_location: stockLocation,
    used_departments: usedDepartments,
    shelf_bin: shelfBin,
    qty,
    min_qty: minQty,
    max_qty: maxQty,
    note,
    image_path: imagePath,
    compatible_machines: compatibleMachines
  };
}

function validateImportPart(part) {
  if (!part.part_code && !part.barcode) {
    return "ไม่มีรหัสอะไหล่หรือบาร์โค้ด";
  }

  if (!part.part_name) {
    return "ไม่มีชื่ออะไหล่";
  }

  return "";
}

function parseMachineList(text = "") {
  return String(text || "")
    .split(/[,/|;]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function importOnePartToSupabase(part) {
  const payloadWithImage = {
    p_barcode: part.barcode || "",
    p_part_code: part.part_code || "",
    p_part_name: part.part_name || "",
    p_model: part.model || "",
    p_brand: part.brand || "",
    p_category: part.category || "",
    p_unit: part.unit || "Pcs",
    p_stock_location: part.stock_location || "Main MVR/MSR Stock",
    p_used_departments: part.used_departments || "MVR,MSR",
    p_shelf_bin: part.shelf_bin || "",
    p_qty: Number(part.qty || 0),
    p_min_qty: Number(part.min_qty || 0),
    p_max_qty: Number(part.max_qty || 0),
    p_note: part.note || "",
    p_image_path: part.image_path || ""
  };

  let { error } = await sb.rpc("import_stock_row", payloadWithImage);

  // fallback สำหรับกรณี SQL ยังเป็น function เก่า ไม่มี p_image_path
  if (error && String(error.message || "").includes("Could not find the function")) {
    const payloadWithoutImage = { ...payloadWithImage };
    delete payloadWithoutImage.p_image_path;

    const retry = await sb.rpc("import_stock_row", payloadWithoutImage);
    error = retry.error;
  }

  if (error) throw error;

  // บันทึก compatible machines ถ้า function เดิมมีอยู่
  if (typeof getPartIdByPartCode === "function" && typeof savePartCompatibleMachines === "function") {
    const machines = parseMachineList(part.compatible_machines);
    if (machines.length) {
      const partId = await getPartIdByPartCode(part.part_code);
      if (partId) {
        await savePartCompatibleMachines(partId, machines);
      }
    }
  }
}

async function importPartsFromFile(e) {
  if (!canEditParts()) return showToast("สิทธิ์นี้ไม่สามารถ Import อะไหล่ในคลังได้", "error");
  const file = e.target.files && e.target.files[0];

  if (!file) return;

  const fileName = file.name || "";
  const ext = fileName.split(".").pop().toLowerCase();

  if (!["xlsx", "xls", "csv"].includes(ext)) {
    showToast("รองรับเฉพาะไฟล์ .xlsx, .xls, .csv", "warn");
    e.target.value = "";
    return;
  }

  if (typeof XLSX === "undefined") {
    showToast("ไม่พบไลบรารี XLSX กรุณาเช็ก script ใน index.html", "error");
    e.target.value = "";
    return;
  }

  showImportModal("Import Excel", `กำลังอ่านไฟล์ ${fileName}`);

  try {
    updateImportProgress(5, "กำลังอ่านไฟล์...");

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      throw new Error("ไม่พบ Sheet ในไฟล์ Excel");
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rawRows.length) {
      throw new Error("ไฟล์ไม่มีข้อมูลสำหรับ Import");
    }

    const rows = rawRows.map((row, index) => normalizeImportRowV2(row, index));
    const validRows = [];
    const invalidRows = [];

    rows.forEach((part) => {
      const err = validateImportPart(part);

      if (err) {
        invalidRows.push({
          rowNumber: part.rowNumber,
          error: err
        });
      } else {
        validRows.push(part);
      }
    });

    if (!validRows.length) {
      updateImportProgress(100, "Import ไม่สำเร็จ");
      addImportLog("error", "ไม่มีข้อมูลที่ถูกต้องสำหรับ Import");
      invalidRows.slice(0, 10).forEach((r) => {
        addImportLog("error", `แถว ${r.rowNumber}: ${r.error}`);
      });
      showToast("Import ไม่สำเร็จ: ข้อมูลไม่ถูกต้อง", "error");
      return;
    }

    document.querySelector("#importStatusSub").textContent =
      `พบข้อมูล ${rawRows.length} แถว / ใช้งานได้ ${validRows.length} แถว`;

    invalidRows.slice(0, 8).forEach((r) => {
      addImportLog("warn", `ข้ามแถว ${r.rowNumber}: ${r.error}`);
    });

    let success = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < validRows.length; i++) {
      const part = validRows[i];

      const percent = 10 + ((i + 1) / validRows.length) * 80;
      updateImportProgress(
        percent,
        `กำลังอัปโหลด ${i + 1}/${validRows.length}: ${part.part_code || part.barcode}`
      );

      try {
        await importOnePartToSupabase(part);
        success += 1;
      } catch (err) {
        failed += 1;
        errors.push({
          rowNumber: part.rowNumber,
          code: part.part_code,
          message: err.message || "ไม่ทราบสาเหตุ"
        });
      }
    }

    updateImportProgress(95, "กำลังรีเฟรชข้อมูล...");

    await refreshAll();

    updateImportProgress(100, "Import เสร็จเรียบร้อย");

    if (success > 0) {
      addImportLog("success", `Import สำเร็จ ${success} รายการ`);
    }

    if (failed > 0) {
      addImportLog("error", `Import ไม่สำเร็จ ${failed} รายการ`);
      errors.slice(0, 10).forEach((r) => {
        addImportLog("error", `แถว ${r.rowNumber} (${r.code || "-"}): ${r.message}`);
      });
    }

    if (invalidRows.length > 0) {
      addImportLog("warn", `ข้ามข้อมูลไม่สมบูรณ์ ${invalidRows.length} แถว`);
    }

    if (success && !failed) {
      document.querySelector("#importStatusIcon").textContent = "✅";
      document.querySelector("#importStatusTitle").textContent = "Import สำเร็จ";
      document.querySelector("#importStatusSub").textContent =
        `อัปโหลดข้อมูลเรียบร้อย ${success} รายการ`;
      showToast(`Import Excel สำเร็จ ${success} รายการ`, "success");
    } else if (success && failed) {
      document.querySelector("#importStatusIcon").textContent = "⚠️";
      document.querySelector("#importStatusTitle").textContent = "Import สำเร็จบางส่วน";
      document.querySelector("#importStatusSub").textContent =
        `สำเร็จ ${success} รายการ / ไม่สำเร็จ ${failed} รายการ`;
      showToast(`Import สำเร็จบางส่วน: ${success} สำเร็จ, ${failed} ไม่สำเร็จ`, "warn");
    } else {
      document.querySelector("#importStatusIcon").textContent = "❌";
      document.querySelector("#importStatusTitle").textContent = "Import ไม่สำเร็จ";
      document.querySelector("#importStatusSub").textContent =
        `ไม่สามารถอัปโหลดข้อมูลได้`;
      showToast("Import Excel ไม่สำเร็จ", "error");
    }
  } catch (err) {
    console.error(err);
    updateImportProgress(100, "Import ไม่สำเร็จ");
    document.querySelector("#importStatusIcon").textContent = "❌";
    document.querySelector("#importStatusTitle").textContent = "Import ไม่สำเร็จ";
    document.querySelector("#importStatusSub").textContent = err.message || "เกิดข้อผิดพลาด";
    addImportLog("error", err.message || "เกิดข้อผิดพลาดระหว่าง Import");
    showToast("Import Excel ไม่สำเร็จ: " + err.message, "error");
  } finally {
    e.target.value = "";
  }
}

/* =========================================================
   FINAL IMPORT EXCEL FIX - 2026-05-06
   จุดที่แก้:
   1) แก้ renderSettings is not defined
   2) แก้ Import Excel ให้รองรับไฟล์อะไหล่เดิม
   3) แจ้งผลสำเร็จ / ไม่สำเร็จแบบละเอียด
   4) ไม่ให้ Import ล้มเพราะ render หน้า Settings
========================================================= */

function renderSettings() {
  try {
    if (typeof renderFilters === "function") renderFilters();
    if (typeof renderDynamicDropdowns === "function") renderDynamicDropdowns();
    if (typeof renderOptionsManager === "function") renderOptionsManager();
    if (typeof renderCategoryDatalist === "function") renderCategoryDatalist();
    if (typeof renderUnitDatalist === "function") renderUnitDatalist();
    if (typeof renderStockLocationDropdowns === "function") renderStockLocationDropdowns();
    if (typeof renderUserDepartmentSelect === "function") renderUserDepartmentSelect();
    if (typeof renderLocationManager === "function") renderLocationManager();
    if (typeof renderUserManager === "function") renderUserManager();
  } catch (err) {
    console.warn("renderSettings warning:", err);
  }
}

async function refreshAfterImportOnly() {
  await Promise.all([
    typeof loadDepartments === "function" ? loadDepartments() : Promise.resolve(),
    typeof loadLocations === "function" ? loadLocations() : Promise.resolve(),
    typeof loadMasterOptions === "function" ? loadMasterOptions() : Promise.resolve(),
    typeof loadUsers === "function" ? loadUsers() : Promise.resolve(),
    typeof loadParts === "function" ? loadParts() : Promise.resolve(),
    typeof loadHistory === "function" ? loadHistory() : Promise.resolve(),
    typeof loadProcurementTracking === "function" ? loadProcurementTracking() : Promise.resolve()
  ]);

  [
    "renderDashboard",
    "renderFilters",
    "renderPOSGrids",
    "renderReceiveCart",
    "renderIssueCart",
    "renderPurchasePage",
    "renderTopIssuePage",
    "renderHistory",
    "renderSettings",
    "applyRoleAccessUI"
  ].forEach((fnName) => {
    try {
      if (typeof window[fnName] === "function") window[fnName]();
      else if (typeof eval(fnName) === "function") eval(fnName)();
    } catch (err) {
      console.warn(`${fnName} warning:`, err);
    }
  });
}

function importPick(row, keys) {
  const normalize = (x) => String(x || "").replace(/\s+/g, "").toLowerCase();

  const rowKeys = Object.keys(row || {});
  for (const targetKey of keys) {
    const direct = row[targetKey];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return String(direct).trim();
    }

    const targetNorm = normalize(targetKey);
    const realKey = rowKeys.find((k) => normalize(k) === targetNorm);
    if (realKey && row[realKey] !== undefined && row[realKey] !== null && String(row[realKey]).trim() !== "") {
      return String(row[realKey]).trim();
    }
  }

  return "";
}

function importNumber(row, keys, fallback = 0) {
  const value = importPick(row, keys);
  if (value === "") return fallback;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function normalizeImportExcelRow(row, index) {
  const barcode = importPick(row, [
    "บาร์โค้ด", "Barcode", "barcode", "BARCODE", "BarcodeText", "Barcode Text"
  ]);

  const partCode = importPick(row, [
    "รหัสอะไหล่", "รหัส", "Part Code", "PartCode", "PartID", "Code", "code", "Part No", "PartNo"
  ]);

  const partName = importPick(row, [
    "ชื่ออะไหล่", "ชื่อ", "Part Name", "PartName", "Name", "name", "Description", "รายการ"
  ]);

  const machineText = importPick(row, [
    "ใช้กับเครื่องจักร", "ใช้กับเครื่อง", "เครื่องจักรที่ใช้", "Compatible Machines", "Compatible Machine", "Machines", "Machine", "machine"
  ]);

  return {
    rowNumber: index + 2,
    barcode,
    part_code: partCode || barcode,
    part_name: partName,
    model: importPick(row, ["รุ่น", "Model", "model", "Spec", "Specification"]),
    brand: importPick(row, ["ยี่ห้อ", "Brand", "brand", "Maker", "Manufacturer"]),
    category: importPick(row, ["หมวดหมู่", "Category", "category", "Type", "Group"]),
    unit: importPick(row, ["หน่วย", "Unit", "unit", "UOM"]) || "Pcs",
    stock_location: importPick(row, [
      "จุดเก็บ", "จุดเก็บสต็อก", "Stock Location", "stock_location", "Location", "location", "Store", "Warehouse"
    ]) || "Main MVR/MSR Stock",
    used_departments: importPick(row, [
      "แผนกที่ใช้ร่วมกัน", "แผนกที่ใช้", "ใช้โดย", "Used Departments", "Departments", "used_departments", "Department", "department", "แผนก", "แผนกที่ใช้งาน"
    ]) || "MVR,MSR",
    shelf_bin: importPick(row, [
      "ตำแหน่งจัดเก็บ", "ตำแหน่ง", "Shelf / Bin", "Shelf", "Bin", "shelf_bin", "Rack"
    ]),
    qty: importNumber(row, ["จำนวนคงเหลือ", "คงเหลือ", "จำนวน", "Qty", "qty", "Quantity", "Stock", "stock"], 0),
    min_qty: importNumber(row, ["Min Qty", "Min", "min_qty", "ขั้นต่ำ", "จำนวนขั้นต่ำ"], 0),
    max_qty: importNumber(row, ["Max Qty", "Max", "max_qty", "สูงสุด", "จำนวนสูงสุด"], 0),
    compatible_machines_values: String(machineText || "")
      .split(/[,，\/|;]/)
      .map((x) => x.trim())
      .filter(Boolean),
    image_path: importPick(row, ["รูป", "รูปอะไหล่", "Image", "Image URL", "image_path", "image_url"]),
    note: importPick(row, ["หมายเหตุ", "Note", "note", "Remark", "Remarks"])
  };
}

function validateImportExcelPart(part) {
  if (!part.part_code && !part.barcode) return "ไม่มีรหัสอะไหล่หรือบาร์โค้ด";
  if (!part.part_name) return "ไม่มีชื่ออะไหล่";
  return "";
}

async function importPartRowToSupabase(part) {
  const payload = {
    p_barcode: part.barcode || "",
    p_part_code: part.part_code || "",
    p_part_name: part.part_name || "",
    p_model: part.model || "",
    p_brand: part.brand || "",
    p_category: part.category || "",
    p_unit: part.unit || "Pcs",
    p_stock_location: part.stock_location || "Main MVR/MSR Stock",
    p_used_departments: part.used_departments || "MVR,MSR",
    p_shelf_bin: part.shelf_bin || "",
    p_qty: Number(part.qty || 0),
    p_min_qty: Number(part.min_qty || 0),
    p_max_qty: Number(part.max_qty || 0),
    p_note: part.note || "",
    p_image_path: part.image_path || ""
  };

  let result = await sb.rpc("import_stock_row", payload);

  if (result.error && String(result.error.message || "").includes("Could not find the function")) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.p_image_path;
    result = await sb.rpc("import_stock_row", fallbackPayload);
  }

  if (result.error) throw result.error;

  if (
    part.compatible_machines_values &&
    part.compatible_machines_values.length &&
    typeof getPartIdByPartCode === "function" &&
    typeof savePartCompatibleMachines === "function"
  ) {
    const partId = await getPartIdByPartCode(part.part_code || part.barcode);
    if (partId) await savePartCompatibleMachines(partId, part.compatible_machines_values);
  }

  return result.data || "updated";
}

function safeImportModal(title, sub) {
  if (typeof showImportModal === "function") {
    showImportModal(title, sub);
  } else {
    showToast(sub || title, "success");
  }
}

function safeUpdateImportProgress(percent, text) {
  if (typeof updateImportProgress === "function") updateImportProgress(percent, text);
}

function safeAddImportLog(type, text) {
  if (typeof addImportLog === "function") addImportLog(type, text);
  else console.log(`[${type}] ${text}`);
}

async function importPartsFromFile(e) {
  if (!canEditParts()) return showToast("สิทธิ์นี้ไม่สามารถ Import อะไหล่ในคลังได้", "error");
  const input = e?.target || document.querySelector("#excelFileInput");
  const file = input?.files && input.files[0];

  if (!file) return;

  const fileName = file.name || "";
  const ext = fileName.split(".").pop().toLowerCase();

  if (!["xlsx", "xls", "csv"].includes(ext)) {
    showToast("รองรับเฉพาะไฟล์ .xlsx, .xls, .csv", "warn");
    if (input) input.value = "";
    return;
  }

  if (typeof XLSX === "undefined") {
    showToast("ไม่พบไลบรารี XLSX กรุณาเช็ก script xlsx.full.min.js ใน index.html", "error");
    if (input) input.value = "";
    return;
  }

  safeImportModal("Import Excel", `กำลังอ่านไฟล์ ${fileName}`);

  try {
    safeUpdateImportProgress(5, "กำลังอ่านไฟล์ Excel...");

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    if (!workbook.SheetNames || !workbook.SheetNames.length) {
      throw new Error("ไม่พบ Sheet ในไฟล์ Excel");
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", blankrows: false });

    if (!rawRows.length) {
      throw new Error("ไฟล์ไม่มีข้อมูลสำหรับ Import");
    }

    const rows = rawRows.map((row, index) => normalizeImportExcelRow(row, index));
    const validRows = [];
    const invalidRows = [];

    rows.forEach((part) => {
      const err = validateImportExcelPart(part);
      if (err) invalidRows.push({ rowNumber: part.rowNumber, error: err });
      else validRows.push(part);
    });

    if (!validRows.length) {
      safeUpdateImportProgress(100, "Import ไม่สำเร็จ");
      safeAddImportLog("error", "ไม่มีข้อมูลที่ถูกต้องสำหรับ Import");
      invalidRows.slice(0, 20).forEach((r) => safeAddImportLog("error", `แถว ${r.rowNumber}: ${r.error}`));
      showToast("Import ไม่สำเร็จ: ไม่มีข้อมูลที่ถูกต้อง", "error");
      return;
    }

    const sub = document.querySelector("#importStatusSub");
    if (sub) sub.textContent = `พบข้อมูล ${rawRows.length} แถว / พร้อมอัปโหลด ${validRows.length} แถว`;

    invalidRows.slice(0, 10).forEach((r) => {
      safeAddImportLog("warn", `ข้ามแถว ${r.rowNumber}: ${r.error}`);
    });

    let inserted = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < validRows.length; i++) {
      const part = validRows[i];
      const percent = 8 + ((i + 1) / validRows.length) * 84;

      safeUpdateImportProgress(
        percent,
        `กำลังอัปโหลด ${i + 1}/${validRows.length}: ${part.part_code || part.barcode}`
      );

      try {
        const result = await importPartRowToSupabase(part);
        if (result === "inserted") inserted += 1;
        else updated += 1;
      } catch (err) {
        failed += 1;
        errors.push({
          rowNumber: part.rowNumber,
          code: part.part_code || part.barcode || "-",
          message: err.message || String(err)
        });
      }
    }

    safeUpdateImportProgress(96, "กำลังรีเฟรชข้อมูลในระบบ...");
    await refreshAfterImportOnly();

    safeUpdateImportProgress(100, "Import เสร็จเรียบร้อย");

    if (inserted || updated) {
      safeAddImportLog("success", `Import สำเร็จ ${inserted + updated} รายการ | เพิ่มใหม่ ${inserted} | อัปเดต ${updated}`);
    }

    if (failed) {
      safeAddImportLog("error", `Import ไม่สำเร็จ ${failed} รายการ`);
      errors.slice(0, 20).forEach((r) => safeAddImportLog("error", `แถว ${r.rowNumber} (${r.code}): ${r.message}`));
    }

    if (invalidRows.length) {
      safeAddImportLog("warn", `ข้ามข้อมูลไม่สมบูรณ์ ${invalidRows.length} แถว`);
    }

    const icon = document.querySelector("#importStatusIcon");
    const title = document.querySelector("#importStatusTitle");
    const msg = document.querySelector("#importStatusSub");

    if (failed === 0) {
      if (icon) icon.textContent = "✅";
      if (title) title.textContent = "Import สำเร็จ";
      if (msg) msg.textContent = `อัปโหลดเรียบร้อย ${inserted + updated} รายการ`;
      showToast(`Import สำเร็จ ${inserted + updated} รายการ`, "success");
    } else if (inserted + updated > 0) {
      if (icon) icon.textContent = "⚠️";
      if (title) title.textContent = "Import สำเร็จบางส่วน";
      if (msg) msg.textContent = `สำเร็จ ${inserted + updated} รายการ / ไม่สำเร็จ ${failed} รายการ`;
      showToast(`Import สำเร็จบางส่วน: สำเร็จ ${inserted + updated}, ไม่สำเร็จ ${failed}`, "warn");
    } else {
      if (icon) icon.textContent = "❌";
      if (title) title.textContent = "Import ไม่สำเร็จ";
      if (msg) msg.textContent = `ไม่สามารถอัปโหลดข้อมูลได้`;
      showToast("Import ไม่สำเร็จ", "error");
    }
  } catch (err) {
    console.error(err);
    safeUpdateImportProgress(100, "Import ไม่สำเร็จ");
    const icon = document.querySelector("#importStatusIcon");
    const title = document.querySelector("#importStatusTitle");
    const msg = document.querySelector("#importStatusSub");
    if (icon) icon.textContent = "❌";
    if (title) title.textContent = "Import ไม่สำเร็จ";
    if (msg) msg.textContent = err.message || "เกิดข้อผิดพลาด";
    safeAddImportLog("error", err.message || "เกิดข้อผิดพลาดระหว่าง Import");
    showToast("Import Excel ไม่สำเร็จ: " + (err.message || err), "error");
  } finally {
    if (input) input.value = "";
  }
}



/* =========================================================
   ADVANCED AI PROCUREMENT ASSISTANT
   คำนวณสั่งซื้อแบบฉลาดจาก Stock, Min/Max, ประวัติการเบิก, Lead Time,
   Safety Stock, Reorder Point, Days to Stockout และสถานะจัดซื้อ
========================================================= */

const AI_PROCUREMENT_CONFIG = {
  leadTimeDays: 30,      // ระยะเวลาซื้อโดยประมาณ ถ้าไม่รู้กำหนดไว้ 30 วัน
  safetyDays: 14,        // กันความเสี่ยงเผื่อใช้ฉุกเฉิน
  reviewDays: 30,        // รอบตรวจสต็อก/รอบสั่งซื้อ
  defaultCoverDays: 60,  // เป้าหมายให้สต็อกพอใช้ประมาณ 2 เดือน ถ้าไม่มี Max
  recentDays: 30,
  historyDays: 90,
  displayLimit: 8
};

function clampNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function parseTimeSafe(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function getPartHistoryUsage(part, days = 90) {
  const now = Date.now();
  const fromTime = now - days * 24 * 60 * 60 * 1000;

  const partCode = String(part.part_code || "").trim();
  const barcode = String(part.barcode || "").trim();
  const partName = String(part.part_name || "").trim();

  const rows = state.history.filter((h) => {
    const isOut = String(h.txn_type || "").toUpperCase() === "OUT";
    const time = parseTimeSafe(h.created_at);

    const samePart =
      String(h.part_code || "").trim() === partCode ||
      String(h.barcode || "").trim() === barcode ||
      String(h.part_name || "").trim() === partName;

    return isOut && samePart && time >= fromTime;
  });

  const qty = rows.reduce((sum, h) => sum + Number(h.qty || 0), 0);
  const count = rows.length;

  const machines = [
    ...new Set(rows.map((h) => String(h.machine_name || "").trim()).filter(Boolean))
  ];

  const reasons = [
    ...new Set(rows.map((h) => String(h.reason || "").trim()).filter(Boolean))
  ];

  const lastTxn = rows
    .slice()
    .sort((a, b) => parseTimeSafe(b.created_at) - parseTimeSafe(a.created_at))[0];

  return {
    rows,
    qty,
    count,
    machines,
    reasons,
    lastDate: lastTxn?.created_at || "",
    avgMonthly: days > 0 ? qty / (days / 30) : 0,
    avgDaily: days > 0 ? qty / days : 0
  };
}

function getPartUsageTrend(part) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const partCode = String(part.part_code || "").trim();
  const barcode = String(part.barcode || "").trim();
  const partName = String(part.part_name || "").trim();

  const matchPart = (h) => {
    const isOut = String(h.txn_type || "").toUpperCase() === "OUT";
    const samePart =
      String(h.part_code || "").trim() === partCode ||
      String(h.barcode || "").trim() === barcode ||
      String(h.part_name || "").trim() === partName;
    return isOut && samePart;
  };

  const recent30 = state.history.filter((h) => {
    const t = parseTimeSafe(h.created_at);
    return matchPart(h) && t >= now - 30 * dayMs;
  });

  const previous30 = state.history.filter((h) => {
    const t = parseTimeSafe(h.created_at);
    return matchPart(h) && t < now - 30 * dayMs && t >= now - 60 * dayMs;
  });

  const recentQty = recent30.reduce((sum, h) => sum + Number(h.qty || 0), 0);
  const previousQty = previous30.reduce((sum, h) => sum + Number(h.qty || 0), 0);

  let trend = 0;
  if (previousQty > 0) trend = (recentQty - previousQty) / previousQty;
  else if (recentQty > 0) trend = 1;

  return {
    recentQty,
    previousQty,
    trend,
    trendPercent: Math.round(trend * 100),
    trendText:
      trend >= 0.5 ? "การใช้เพิ่มขึ้น" :
      trend <= -0.5 ? "การใช้ลดลง" :
      recentQty > 0 ? "ใช้งานต่อเนื่อง" :
      "ไม่พบการเบิกล่าสุด"
  };
}

function getIncomingProcurement(part) {
  const proc = getProcurementRow(part.stock_balance_id);
  const status = String(proc?.status || "need_order");
  const activeIncoming = ["ordering", "po_open", "waiting_delivery"].includes(status);
  const qty = activeIncoming ? Number(proc?.qty_to_order || 0) : 0;
  const expectedDate = proc?.expected_date || "";
  const expectedTime = expectedDate ? parseTimeSafe(expectedDate) : 0;
  const daysToArrive = expectedTime ? Math.ceil((expectedTime - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  return {
    proc,
    status,
    activeIncoming,
    qty,
    expectedDate,
    daysToArrive
  };
}

function calculateSmartProcurementMetrics(part) {
  const cfg = AI_PROCUREMENT_CONFIG;
  const qty = clampNumber(part.qty);
  const minQty = clampNumber(part.min_qty);
  const maxQty = clampNumber(part.max_qty);

  const stockStatus = getStockStatus(part);
  const usage30 = getPartHistoryUsage(part, cfg.recentDays);
  const usage90 = getPartHistoryUsage(part, cfg.historyDays);
  const trend = getPartUsageTrend(part);
  const incoming = getIncomingProcurement(part);

  // ใช้ 90 วันเป็นฐาน ถ้าไม่มีข้อมูล ใช้ 30 วัน ถ้ามีแนวโน้มเพิ่มให้เผื่อ Demand มากขึ้น
  let avgDaily = usage90.avgDaily || usage30.avgDaily || 0;
  if (trend.trend >= 0.5 && usage30.avgDaily > avgDaily) {
    avgDaily = usage30.avgDaily;
  }

  const avgMonthly = avgDaily * 30;
  const daysLeft = avgDaily > 0 ? Math.floor(qty / avgDaily) : null;
  const daysLeftAfterIncoming = avgDaily > 0 ? Math.floor((qty + incoming.qty) / avgDaily) : null;

  const reorderPoint = Math.ceil(avgDaily * (cfg.leadTimeDays + cfg.safetyDays));
  const safetyStock = Math.ceil(avgDaily * cfg.safetyDays);

  const targetByMax = maxQty > 0 ? maxQty : 0;
  const targetByUsage = avgDaily > 0 ? Math.ceil(avgDaily * cfg.defaultCoverDays) : 0;
  const targetByMin = minQty > 0 ? minQty * 2 : 0;
  const targetStock = Math.max(targetByMax, targetByUsage, targetByMin, minQty);

  let suggestQty = Math.max(0, targetStock - qty - incoming.qty);

  // ถ้าต่ำกว่า Min หรือหมด แต่ไม่มี Max/History ให้สั่งอย่างน้อยถึง Min
  if (suggestQty <= 0 && ["out", "low"].includes(stockStatus.key)) {
    suggestQty = Math.max(1, minQty - qty - incoming.qty);
  }

  // ถ้ามีฟังก์ชันเดิมช่วยคำนวณ ให้ใช้เป็นค่าขั้นต่ำด้วย
  if (typeof suggestOrderQty === "function") {
    suggestQty = Math.max(suggestQty, Number(suggestOrderQty(part) || 0) - incoming.qty);
  }

  suggestQty = Math.max(0, Math.ceil(suggestQty));

  const willStockoutBeforeLeadTime = daysLeft !== null && daysLeft <= cfg.leadTimeDays;
  const belowReorderPoint = qty <= reorderPoint;
  const incomingLate = incoming.activeIncoming && incoming.daysToArrive !== null && daysLeft !== null && incoming.daysToArrive > daysLeft;

  let score = 0;
  const reasons = [];

  if (stockStatus.key === "out") {
    score += 160;
    reasons.push("หมดสต็อก");
  }
  if (stockStatus.key === "low") {
    score += 100;
    reasons.push("ต่ำกว่า/ใกล้ Min");
  }
  if (willStockoutBeforeLeadTime) {
    score += 90;
    reasons.push(`คาดว่าจะหมดใน ${daysLeft} วัน`);
  }
  if (belowReorderPoint && avgDaily > 0) {
    score += 70;
    reasons.push(`ต่ำกว่า ROP ${numberFormat(reorderPoint)}`);
  }
  if (usage90.qty > 0) {
    score += Math.min(55, usage90.qty * 3);
    reasons.push(`เบิก 90 วัน ${numberFormat(usage90.qty)} ${part.unit || "Pcs"}`);
  }
  if (trend.trend >= 0.5) {
    score += 30;
    reasons.push("การใช้เพิ่มขึ้น");
  }
  if (incoming.activeIncoming) {
    score -= 30;
    reasons.push(`มีรายการจัดซื้อ ${numberFormat(incoming.qty)} ${part.unit || "Pcs"}`);
  }
  if (incomingLate) {
    score += 35;
    reasons.push("ของอาจมาช้ากว่าวันหมด");
  }
  if (suggestQty > 0) {
    score += 35;
    reasons.push(`แนะนำสั่ง ${numberFormat(suggestQty)} ${part.unit || "Pcs"}`);
  }

  const riskPercent = Math.max(0, Math.min(100, Math.round(score / 3)));

  let level = "normal";
  let levelText = "ติดตาม";
  let aiAction = "ติดตามสต็อก";

  if (stockStatus.key === "out" || willStockoutBeforeLeadTime || incomingLate) {
    level = "critical";
    levelText = "เร่งด่วน";
    aiAction = incoming.activeIncoming ? "เร่งติดตามของเข้า" : "สั่งซื้อทันที";
  } else if (stockStatus.key === "low" || belowReorderPoint || suggestQty > 0) {
    level = "warning";
    levelText = "ควรสั่ง";
    aiAction = incoming.activeIncoming ? "ติดตาม PO" : "เปิด PR/PO";
  }

  return {
    part,
    stockStatus: stockStatus.key,
    stockText: stockStatus.text,
    usage30,
    usage90,
    trend,
    incoming,
    qty,
    minQty,
    maxQty,
    avgDaily,
    avgMonthly,
    daysLeft,
    daysLeftAfterIncoming,
    reorderPoint,
    safetyStock,
    targetStock,
    suggestQty,
    willStockoutBeforeLeadTime,
    belowReorderPoint,
    incomingLate,
    level,
    levelText,
    aiAction,
    riskPercent,
    score,
    reasons: reasons.slice(0, 6)
  };
}

function buildAIProcurementRows(limit = AI_PROCUREMENT_CONFIG.displayLimit) {
  return state.parts
    .map(calculateSmartProcurementMetrics)
    .filter((x) =>
      x.score > 0 ||
      x.suggestQty > 0 ||
      ["out", "low"].includes(x.stockStatus) ||
      x.willStockoutBeforeLeadTime ||
      x.belowReorderPoint
    )
    .sort((a, b) => b.score - a.score || b.suggestQty - a.suggestQty)
    .slice(0, limit);
}

function getAIProcurementRowByStockBalanceId(stockBalanceId) {
  return state.parts
    .map(calculateSmartProcurementMetrics)
    .find((x) => String(x.part.stock_balance_id) === String(stockBalanceId));
}

function generatePurchaseApprovalText(stockBalanceId) {
  const item = getAIProcurementRowByStockBalanceId(stockBalanceId);
  if (!item) return "";

  const p = item.part;
  const unit = p.unit || "Pcs";
  const suggestQty = Math.max(1, Number(item.suggestQty || 0));

  const machineText = item.usage90.machines.length
    ? item.usage90.machines.slice(0, 6).join(", ")
    : (p.compatible_machines || "-");

  const reasonText = item.usage90.reasons.length
    ? item.usage90.reasons.slice(0, 4).join(", ")
    : "ใช้สำหรับซ่อมบำรุง / PM / สำรองกรณีเครื่องจักรเสียฉุกเฉิน";

  const daysLeftText = item.daysLeft !== null
    ? `คาดว่าสต็อกจะเพียงพอประมาณ ${item.daysLeft} วัน จากค่าเฉลี่ยการใช้งานปัจจุบัน`
    : "ไม่มีค่าเฉลี่ยการใช้งานที่แน่นอน แต่เป็นอะไหล่ที่ต้องสำรองเพื่อรองรับงานซ่อม";

  const incomingText = item.incoming.activeIncoming
    ? `มีรายการจัดซื้ออยู่แล้ว ${numberFormat(item.incoming.qty)} ${unit} สถานะ ${getProcurementMeta(item.incoming.status).text}${item.incoming.expectedDate ? ` กำหนดเข้า ${item.incoming.expectedDate}` : ""}`
    : "ยังไม่มีรายการจัดซื้อที่กำลังดำเนินการในระบบ";

  const riskText =
    item.stockStatus === "out"
      ? "ปัจจุบันอะไหล่หมดสต็อก ทำให้มีความเสี่ยงสูงต่อการซ่อมฉุกเฉินและอาจทำให้ Downtime เพิ่มขึ้น"
      : item.willStockoutBeforeLeadTime
      ? `สต็อกมีแนวโน้มหมดภายใน ${item.daysLeft} วัน ซึ่งน้อยกว่าระยะเวลาจัดซื้อประมาณ ${AI_PROCUREMENT_CONFIG.leadTimeDays} วัน`
      : item.belowReorderPoint
      ? `จำนวนคงเหลือต่ำกว่า Reorder Point (${numberFormat(item.reorderPoint)} ${unit}) จึงควรเปิดสั่งซื้อก่อนถึงจุดขาดสต็อก`
      : "รายการนี้มีความสำคัญต่อความพร้อมของอะไหล่และควรติดตามตามรอบสั่งซื้อ";

  return (
`ขออนุมัติสั่งซื้ออะไหล่

รายการ: ${p.part_name || "-"}
รหัสอะไหล่: ${p.part_code || "-"}
รุ่น / ยี่ห้อ: ${p.model || "-"} / ${p.brand || "-"}
จำนวนที่ AI แนะนำให้สั่ง: ${suggestQty} ${unit}
จุดเก็บ: ${p.stock_location_name || "-"}
ตำแหน่ง: ${p.shelf_bin || "-"}
แผนกที่ใช้: ${p.used_departments || "-"}
เครื่องจักรที่เกี่ยวข้อง: ${machineText}

เหตุผลประกอบการสั่งซื้อ:
${riskText}

ข้อมูลวิเคราะห์จากระบบ:
- คงเหลือปัจจุบัน: ${numberFormat(item.qty)} ${unit}
- Min Stock: ${numberFormat(item.minQty)} ${unit}
- Max Stock: ${numberFormat(item.maxQty)} ${unit}
- Safety Stock ที่ AI คำนวณ: ${numberFormat(item.safetyStock)} ${unit}
- Reorder Point (ROP): ${numberFormat(item.reorderPoint)} ${unit}
- Target Stock ที่เหมาะสม: ${numberFormat(item.targetStock)} ${unit}
- ประวัติการเบิก 30 วันล่าสุด: ${numberFormat(item.usage30.qty)} ${unit} (${numberFormat(item.usage30.count)} ครั้ง)
- ประวัติการเบิก 90 วันล่าสุด: ${numberFormat(item.usage90.qty)} ${unit} (${numberFormat(item.usage90.count)} ครั้ง)
- ค่าเฉลี่ยการใช้งาน: ${item.avgMonthly.toFixed(1)} ${unit}/เดือน
- ${daysLeftText}
- แนวโน้มการใช้งาน: ${item.trend.trendText}${item.trend.trendPercent ? ` (${item.trend.trendPercent}%)` : ""}
- สถานะจัดซื้อปัจจุบัน: ${incomingText}
- เหตุผลการใช้งานที่ผ่านมา: ${reasonText}

สรุป:
แนะนำให้อนุมัติการสั่งซื้อรายการนี้ตามจำนวนที่เสนอ เพื่อป้องกันอะไหล่ไม่เพียงพอต่อการซ่อมบำรุง ลดความเสี่ยง Downtime และรองรับงานซ่อมฉุกเฉิน/PM ตามแผน`
  );
}

function showAIApprovalReason(stockBalanceId) {
  const text = generatePurchaseApprovalText(stockBalanceId);
  if (!text) return showToast("ไม่พบข้อมูลสำหรับสร้างเหตุผลสั่งซื้อ", "error");

  document.querySelectorAll(".ai-approval-overlay").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "ai-approval-overlay active";

  overlay.innerHTML = `
    <div class="ai-approval-box">
      <div class="ai-approval-head">
        <div>
          <h3>AI เหตุผลประกอบการสั่งซื้อ</h3>
          <div class="muted">คัดลอกข้อความนี้ไปส่งบัญชีหรือผู้อนุมัติได้ทันที</div>
        </div>
        <button type="button" class="drawer-close-btn ai-approval-close">×</button>
      </div>

      <textarea id="aiApprovalText" class="ai-approval-textarea"></textarea>

      <div class="ai-approval-actions">
        <button type="button" class="btn secondary ai-approval-close">ปิด</button>
        <button type="button" class="btn primary" onclick="copyAIApprovalReason()">คัดลอกเหตุผล</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const textArea = $("#aiApprovalText");
  if (textArea) textArea.value = text;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".ai-approval-close")) {
      overlay.remove();
    }
  });
}

async function copyAIApprovalReason() {
  const el = $("#aiApprovalText");
  if (!el) return;

  const text = el.value || "";

  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกเหตุผลสั่งซื้อเรียบร้อย", "success");
  } catch (_) {
    el.select();
    document.execCommand("copy");
    showToast("คัดลอกเหตุผลสั่งซื้อเรียบร้อย", "success");
  }
}

function goToPurchaseFromAI(stockBalanceId) {
  if (typeof canManageProcurement === "function" && !canManageProcurement()) {
    return showToast("สิทธิ์นี้ไม่สามารถจัดการสถานะจัดซื้อได้", "warn");
  }

  if (typeof window.showSection === "function") {
    window.showSection("purchaseSection");
  } else {
    document.querySelector('button[data-section="purchaseSection"]')?.click();
  }

  setTimeout(() => {
    if (typeof openProcurementModal === "function") {
      openProcurementModal(stockBalanceId);
    }
  }, 250);
}

function renderAIStockAdvisor() {
  const summaryEl = $("#aiStockSummary");
  const listEl = $("#aiStockAdvisorList");

  if (!summaryEl || !listEl) return;

  const allRows = state.parts.map(calculateSmartProcurementMetrics);
  const rows = allRows
    .filter((x) =>
      x.score > 0 ||
      x.suggestQty > 0 ||
      ["out", "low"].includes(x.stockStatus) ||
      x.willStockoutBeforeLeadTime ||
      x.belowReorderPoint
    )
    .sort((a, b) => b.score - a.score || b.suggestQty - a.suggestQty)
    .slice(0, AI_PROCUREMENT_CONFIG.displayLimit);

  const outCount = allRows.filter((x) => x.stockStatus === "out").length;
  const lowCount = allRows.filter((x) => x.stockStatus === "low").length;
  const stockoutInLeadTime = allRows.filter((x) => x.willStockoutBeforeLeadTime).length;
  const belowRopCount = allRows.filter((x) => x.belowReorderPoint).length;
  const pendingIncoming = allRows.filter((x) => x.incoming.activeIncoming).length;
  const suggestTotal = rows.reduce((sum, x) => sum + Number(x.suggestQty || 0), 0);

  summaryEl.innerHTML = `
    <div class="ai-summary-card danger">
      <span>หมดสต็อก</span>
      <strong>${numberFormat(outCount)}</strong>
    </div>

    <div class="ai-summary-card warning">
      <span>ต่ำกว่า ROP</span>
      <strong>${numberFormat(belowRopCount)}</strong>
    </div>

    <div class="ai-summary-card blue">
      <span>คาดหมดใน LT</span>
      <strong>${numberFormat(stockoutInLeadTime)}</strong>
    </div>

    <div class="ai-summary-card green">
      <span>แนะนำสั่งรวม</span>
      <strong>${numberFormat(suggestTotal)}</strong>
    </div>

    <div class="ai-summary-card purple">
      <span>รอของเข้า</span>
      <strong>${numberFormat(pendingIncoming)}</strong>
    </div>

    <div class="ai-summary-card orange">
      <span>ใกล้หมด</span>
      <strong>${numberFormat(lowCount)}</strong>
    </div>
  `;

  listEl.innerHTML =
    rows
      .map((item, index) => {
        const p = item.part;
        const imgSrc = getPartImageSrc(p);
        const unit = p.unit || "Pcs";
        const daysLeftText = item.daysLeft !== null ? `หมดใน ${item.daysLeft} วัน` : "ไม่มีประวัติเฉลี่ย";
        const incomingText = item.incoming.activeIncoming
          ? `รอเข้า ${numberFormat(item.incoming.qty)} ${unit}`
          : `ROP ${numberFormat(item.reorderPoint)}`;

        return `
          <div class="ai-procurement-item ${item.level}">
            <div class="ai-procurement-rank">${index + 1}</div>

            <div class="ai-procurement-img">
              ${renderImageOrBox(imgSrc, p.part_name || "part")}
            </div>

            <div class="ai-procurement-info">
              <div class="ai-procurement-title">${escapeHtml(p.part_name || "-")}</div>
              <div class="ai-procurement-meta">
                ${escapeHtml(p.part_code || "-")} • ${escapeHtml(p.model || "-")} • ${escapeHtml(p.brand || "-")}
              </div>

              <div class="ai-procurement-reasons">
                <span>${escapeHtml(item.aiAction)}</span>
                <span>${escapeHtml(daysLeftText)}</span>
                <span>เบิก 90 วัน: ${numberFormat(item.usage90.qty)} ${escapeHtml(unit)}</span>
                <span>${escapeHtml(incomingText)}</span>
                <span>Target ${numberFormat(item.targetStock)}</span>
                <span>สั่ง ${numberFormat(item.suggestQty)} ${escapeHtml(unit)}</span>
              </div>
            </div>

            <div class="ai-procurement-action">
              <span class="ai-risk ${item.level}">${escapeHtml(item.levelText)} • ${numberFormat(item.riskPercent)}%</span>
              <button type="button" class="btn primary small" onclick="showAIApprovalReason('${escapeHtml(p.stock_balance_id)}')">สร้างเหตุผล</button>
              <button type="button" class="btn secondary small ai-open-po-btn" onclick="goToPurchaseFromAI('${escapeHtml(p.stock_balance_id)}')">เปิดจัดซื้อ</button>
            </div>
          </div>
        `;
      })
      .join("") ||
    `<div class="ai-empty">✅ ตอนนี้ยังไม่มีรายการเสี่ยงสูงจาก AI</div>`;
}

/* =========================================================
   CORESYS READY PATCH - STABILITY / PERFORMANCE / MULTI USER
   Added by ChatGPT on 2026-05-07
   จุดประสงค์:
   1) ลดการ render หนักเมื่อรายการอะไหล่เยอะ
   2) ลดการโหลดประวัติครั้งละมากเกินจำเป็น
   3) รับเข้า/เบิกหลายรายการแบบ atomic ผ่าน stock_move_batch
   4) กันกดซ้ำระหว่างบันทึก
   5) realtime refresh แบบ debounce เมื่อมีหลายคนใช้งาน
========================================================= */

window.CORESYS_READY_PATCH_VERSION = "ready-2026-05-07-v1";
window.CORESYS_READY_PATCH_CONFIG = {
  partsRenderLimit: 240,
  searchDropdownLimit: 30,
  historyLoadLimit: 1200,
  historyRenderLimit: 600,
  realtimeDebounceMs: 1200,
  imageMaxSize: 560,
  imageQuality: 0.72
};

state.ready = state.ready || {
  busy: false,
  realtimeStarted: false,
  refreshTimer: null,
  lastRefreshAt: 0
};

function readyConfig(key) {
  return window.CORESYS_READY_PATCH_CONFIG[key];
}

function setBusyButton(selector, busy, textWhenBusy = "กำลังบันทึก...") {
  const btn = document.querySelector(selector);
  if (!btn) return;

  if (busy) {
    btn.dataset.oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = textWhenBusy;
  } else {
    btn.disabled = false;
    if (btn.dataset.oldText) btn.textContent = btn.dataset.oldText;
    delete btn.dataset.oldText;
  }
}

function buildPartSearchText(p = {}) {
  return [
    p.barcode,
    p.part_code,
    p.part_name,
    p.model,
    p.brand,
    p.category,
    p.compatible_machines,
    p.stock_location_name,
    p.shelf_bin,
    p.used_departments,
    Array.isArray(p.compatible_machine_values) ? p.compatible_machine_values.join(" ") : ""
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function preparePartRows(rows = []) {
  return (rows || []).map((p) => ({
    ...p,
    qty: Number(p.qty || 0),
    min_qty: Number(p.min_qty || 0),
    max_qty: Number(p.max_qty || 0),
    _searchText: buildPartSearchText(p)
  }));
}

async function loadParts() {
  const { data, error } = await sb
    .from("v_stock_overview")
    .select("*")
    .eq("is_active", true)
    .order("part_name", { ascending: true });

  if (error) {
    console.error(error);
    state.parts = state.parts || [];
    return showToast("โหลดรายการอะไหล่ไม่สำเร็จ: " + error.message, "error");
  }

  state.parts = preparePartRows(data || []);
}

async function loadHistory(options = {}) {
  const limit = Number(options.limit || readyConfig("historyLoadLimit") || 1200);
  let query = sb
    .from("transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.employeeId) query = query.eq("employee_id", options.employeeId);
  if (options.txnType) query = query.eq("txn_type", options.txnType);
  if (options.fromDate) query = query.gte("created_at", options.fromDate);
  if (options.toDate) query = query.lt("created_at", options.toDate);

  const { data, error } = await query;

  if (error) {
    console.error(error);
    state.history = state.history || [];
    return showToast("โหลดประวัติไม่สำเร็จ: " + error.message, "error");
  }

  state.history = data || [];
}

async function refreshAll() {
  try {
    await Promise.all([
      loadDepartments(),
      loadLocations(),
      loadMasterOptions(),
      loadUsers(),
      loadParts(),
      loadHistory(),
      loadProcurementTracking()
    ]);

    renderDynamicDropdowns?.();
    renderFilters?.();
    renderPurchaseFilters?.();
    renderDashboard?.();
    renderPOSGrids?.();
    renderReceiveCart?.();
    renderIssueCart?.();
    renderPurchasePage?.();
    renderTopIssuePage?.();
    renderHistory?.();
    renderSettings?.();
    applyRoleAccessUI?.();

    state.ready.lastRefreshAt = Date.now();
    startRealtimeRefreshOnce();
  } catch (err) {
    console.error("refreshAll failed:", err);
    showToast("รีเฟรชข้อมูลไม่สำเร็จ: " + (err.message || err), "error");
  }
}

function scheduleLightRefresh(reason = "data-change") {
  clearTimeout(state.ready.refreshTimer);
  state.ready.refreshTimer = setTimeout(async () => {
    try {
      await Promise.all([loadParts(), loadHistory(), loadProcurementTracking()]);
      renderDashboard?.();
      renderPOSGrids?.();
      renderReceiveCart?.();
      renderIssueCart?.();
      renderPurchasePage?.();
      renderTopIssuePage?.();
      renderHistory?.();
      state.ready.lastRefreshAt = Date.now();
      console.info("CORESYS light refresh:", reason);
    } catch (err) {
      console.warn("light refresh failed", err);
    }
  }, readyConfig("realtimeDebounceMs") || 1200);
}

function startRealtimeRefreshOnce() {
  if (state.ready.realtimeStarted) return;
  if (!sb || typeof sb.channel !== "function") return;

  try {
    state.ready.realtimeStarted = true;

    sb.channel("coresys_inventory_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_balances" }, () => scheduleLightRefresh("stock_balances"))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions" }, () => scheduleLightRefresh("transactions"))
      .on("postgres_changes", { event: "*", schema: "public", table: "parts" }, () => scheduleLightRefresh("parts"))
      .on("postgres_changes", { event: "*", schema: "public", table: "procurement_tracking" }, () => scheduleLightRefresh("procurement_tracking"))
      .subscribe((status) => console.info("CORESYS realtime:", status));
  } catch (err) {
    console.warn("Realtime unavailable:", err);
  }
}

function getFilteredParts() {
  const search = ($("#stockSearchInput")?.value || $("#partsSearch")?.value || "").trim().toLowerCase();
  const dept = $("#departmentFilter")?.value || "";
  const loc = $("#locationFilter")?.value || "";
  const status = $("#statusFilter")?.value || "";
  const cat = state.activeCategory?.parts || "All";

  let rows = state.parts || [];

  if (search) rows = rows.filter((p) => (p._searchText || buildPartSearchText(p)).includes(search));
  if (dept) {
    rows = rows.filter((p) => {
      if (Array.isArray(p.used_department_codes) && p.used_department_codes.includes(dept)) return true;
      return String(p.used_departments || "").split(",").map((x) => x.trim()).includes(dept);
    });
  }
  if (loc) rows = rows.filter((p) => String(p.stock_location_name || "") === String(loc));
  if (status) rows = rows.filter((p) => getStockStatus(p).key === status);
  if (cat && cat !== "All") rows = rows.filter((p) => String(p.category || "ไม่ระบุ") === String(cat));

  return rows;
}

function renderPOSGrids() {
  const container = $("#partsGridContainer");
  if (!container) return;

  renderCategoryPills?.();

  const rows = getFilteredParts();
  const limit = Number(readyConfig("partsRenderLimit") || 240);
  const visibleRows = rows.slice(0, limit);

  const cardsHtml = visibleRows.map((p) => {
    const st = getStockStatus(p);
    const imgSrc = getPartImageSrc(p);

    return `
      <div class="part-card ${st.key === "out" ? "out-stock" : ""}" data-stock-id="${escapeHtml(p.stock_balance_id)}">
        <div class="part-icon">
          ${renderImageOrBox(imgSrc, p.part_name || "part")}
          <span class="unit-badge">${escapeHtml(p.unit || "Pcs")}</span>
          ${st.key !== "normal" ? `<span class="status-badge ${st.key}">${escapeHtml(st.text)}</span>` : ""}
        </div>

        <div class="part-name">${escapeHtml(p.part_name || "")}</div>

        <div class="part-meta">
          <div>${escapeHtml(p.part_code || "-")}</div>
          <div class="part-model-brand-line">
            <span class="part-model-highlight">${escapeHtml(p.model || "-")}</span>
            <span class="part-brand-muted"> / ${escapeHtml(p.brand || "-")}</span>
          </div>
          <div>จุดเก็บ: ${escapeHtml(p.stock_location_name || "-")}</div>
        </div>

        <div class="stock-line">Stock: ${numberFormat(p.qty)} / Min: ${numberFormat(p.min_qty)}</div>
      </div>
    `;
  }).join("");

  const moreHtml = rows.length > limit
    ? `<div class="part-result-info">แสดง ${numberFormat(limit)} จาก ${numberFormat(rows.length)} รายการ — พิมพ์ค้นหา/กรองเพิ่มเพื่อแสดงรายการที่ต้องการเร็วขึ้น</div>`
    : "";

  container.innerHTML = cardsHtml || `<div class="card">ไม่พบข้อมูลอะไหล่</div>`;
  if (moreHtml) container.insertAdjacentHTML("beforeend", moreHtml);

  if (container.dataset.readyClickBound !== "1") {
    container.dataset.readyClickBound = "1";
    container.addEventListener("click", (e) => {
      const card = e.target.closest(".part-card[data-stock-id]");
      if (!card) return;
      openEditPartModal(card.dataset.stockId);
    });
  }
}

function renderSearchDropdown(type, query) {
  const q = String(query || "").trim().toLowerCase();
  const dropdown = type === "receive" ? $("#receiveSearchResults") : $("#issueSearchResults");

  if (!dropdown) return;

  if (!q) {
    dropdown.classList.add("hidden");
    dropdown.innerHTML = "";
    return;
  }

  const limit = Number(readyConfig("searchDropdownLimit") || 30);
  const rows = (state.parts || [])
    .filter((p) => (p._searchText || buildPartSearchText(p)).includes(q))
    .slice(0, limit);

  if (!rows.length) {
    dropdown.innerHTML = `
      <div class="search-dropdown-empty">
        ไม่พบอะไหล่ "${escapeHtml(query)}"
        ${type === "receive" ? `<br><button class="search-action-btn" type="button" data-add-prefill="${escapeHtml(query)}">+ เพิ่มอะไหล่ใหม่</button>` : ""}
      </div>
    `;
    dropdown.classList.remove("hidden");
    return;
  }

  dropdown.innerHTML = rows.map((p) => {
    const st = getStockStatus(p);
    const disabled = type === "issue" && Number(p.qty || 0) <= 0;

    return `
      <div
        class="search-dropdown-item"
        data-stock-balance-id="${escapeHtml(p.stock_balance_id)}"
        aria-disabled="${disabled ? "true" : "false"}"
      >
        <div class="search-icon-box">${renderImageOrBox(getPartImageSrc(p), p.part_name || "part")}</div>
        <div class="search-dropdown-info">
          <div class="search-dropdown-model">${escapeHtml(p.model || "-")} / ${escapeHtml(p.brand || "-")}</div>
          <div class="search-dropdown-name">${escapeHtml(p.part_name || "-")}</div>
          <div class="search-dropdown-sub">
            รหัส: ${escapeHtml(p.part_code || "-")} · จุดเก็บ: ${escapeHtml(p.stock_location_name || "-")} · ใช้กับ: ${escapeHtml(p.compatible_machines || "-")}
          </div>
        </div>
        <div class="stock-pill ${st.key === "out" ? "out" : ""}">Stock: ${numberFormat(p.qty)}</div>
      </div>
    `;
  }).join("");

  dropdown.classList.remove("hidden");
}

window.selectReceiveSearchResult = function (stockBalanceId) {
  const part = (state.parts || []).find((p) => String(p.stock_balance_id) === String(stockBalanceId));
  if (!part) return showToast("ไม่พบรายการอะไหล่นี้", "error");

  addItemToCart("receive", part);
  clearSearch("receive");
};

window.selectIssueSearchResult = function (stockBalanceId) {
  const part = (state.parts || []).find((p) => String(p.stock_balance_id) === String(stockBalanceId));
  if (!part) return showToast("ไม่พบรายการอะไหล่นี้", "error");
  if (Number(part.qty || 0) <= 0) return showToast("สินค้าหมดสต็อก ไม่สามารถเบิกได้", "error");

  addItemToCart("issue", part);
  clearSearch("issue");
};

function addItemToCart(type, part) {
  const cart = type === "receive" ? state.receiveCart : state.issueCart;
  const existing = cart.find((item) => String(item.stock_balance_id) === String(part.stock_balance_id));
  const available = Number(part.qty || 0);

  if (type === "issue" && available <= 0) return showToast("สินค้าหมดสต็อก ไม่สามารถเบิกได้", "error");

  if (existing) {
    if (type === "issue" && Number(existing.qty || 0) >= available) {
      return showToast(`สต็อกมีแค่ ${numberFormat(available)} ${part.unit || "Pcs"}`, "warn");
    }
    existing.qty += 1;
  } else {
    cart.push({
      stock_balance_id: part.stock_balance_id,
      part_id: part.part_id,
      barcode: part.barcode || "",
      part_code: part.part_code || "",
      part_name: part.part_name || "",
      model: part.model || "",
      brand: part.brand || "",
      compatible_machines: part.compatible_machines || "",
      stock_location_name: part.stock_location_name || "",
      used_departments: part.used_departments || "",
      stock_qty: available,
      unit: part.unit || "Pcs",
      image_path: getPartImageSrc(part),
      qty: 1
    });
  }

  if (type === "receive") renderReceiveCart();
  else renderIssueCart();

  showToast(type === "receive" ? "เพิ่มเข้ารายการรับเข้าแล้ว" : "เพิ่มเข้ารายการเบิกแล้ว", "success");
}

function normalizeCartItemsForBatch(cart, type) {
  return (cart || [])
    .map((item) => ({
      stock_balance_id: item.stock_balance_id,
      qty: Math.max(0, toInt(item.qty)),
      part_name: item.part_name || "",
      stock_qty: Number(item.stock_qty || 0),
      unit: item.unit || "Pcs"
    }))
    .filter((item) => item.stock_balance_id && item.qty > 0)
    .map((item) => {
      if (type === "OUT" && item.qty > item.stock_qty) {
        throw new Error(`${item.part_name || "รายการนี้"} มีสต็อกแค่ ${numberFormat(item.stock_qty)} ${item.unit}`);
      }
      return item;
    });
}

async function rpcStockMoveBatch(txnType, cartItems, meta) {
  const items = normalizeCartItemsForBatch(cartItems, txnType);
  if (!items.length) throw new Error("ไม่มีรายการที่ถูกต้อง");

  const payload = items.map((item) => ({
    stock_balance_id: item.stock_balance_id,
    qty: item.qty,
    employee_name: meta.employee_name || "",
    employee_id: meta.employee_id || "",
    machine_name: meta.machine_name || "",
    document_no: meta.document_no || "",
    reason: meta.reason || "",
    remark: meta.remark || ""
  }));

  const { data, error } = await sb.rpc("stock_move_batch", {
    p_txn_type: txnType,
    p_items: payload
  });

  if (!error) return data;

  const msg = String(error.message || "");

  if (!msg.includes("stock_move_batch")) {
    throw error;
  }

  console.warn("stock_move_batch not found, fallback to stock_move. Please run SETUP_SQL_READY.sql for atomic multi-user save.");

  for (const item of payload) {
    const result = await sb.rpc("stock_move", {
      p_txn_type: txnType,
      p_stock_balance_id: item.stock_balance_id,
      p_qty: item.qty,
      p_employee_name: item.employee_name,
      p_employee_id: item.employee_id,
      p_machine_name: item.machine_name,
      p_document_no: item.document_no,
      p_reason: item.reason,
      p_remark: item.remark
    });
    if (result.error) throw result.error;
  }

  return [];
}

async function refreshAfterStockTransaction() {
  await Promise.all([loadParts(), loadHistory(), loadProcurementTracking()]);
  renderDashboard?.();
  renderPOSGrids?.();
  renderReceiveCart?.();
  renderIssueCart?.();
  renderPurchasePage?.();
  renderTopIssuePage?.();
  renderHistory?.();
  applyCurrentUser?.();
}

async function confirmReceiveAll() {
  if (state.ready.busy) return showToast("ระบบกำลังบันทึกรายการก่อนหน้าอยู่", "warn");
  if (!canReceiveStock()) return showToast("คุณไม่มีสิทธิ์รับเข้าสินค้า", "error");
  if (!state.receiveCart.length) return showToast("ไม่มีรายการรับเข้า", "warn");

  const validItems = normalizeCartItemsForBatch(state.receiveCart, "IN");
  const totalQty = validItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  const ok = await iosConfirm(
    "ยืนยันรับเข้า",
    `รับสินค้า ${validItems.length} รายการ\nจำนวนรวม ${numberFormat(totalQty)}\n\nยืนยันบันทึกเข้าระบบใช่หรือไม่?`
  );
  if (!ok) return;

  try {
    state.ready.busy = true;
    setBusyButton("#confirmReceiveBtn", true, "กำลังรับเข้า...");

    await rpcStockMoveBatch("IN", state.receiveCart, {
      employee_name: $("#receiveEmployeeName")?.value || state.currentUser?.full_name || "",
      employee_id: $("#receiveEmployeeId")?.value || state.currentUser?.employee_code || "",
      machine_name: "",
      document_no: $("#receiveDocNo")?.value || "",
      reason: "Receive Stock",
      remark: $("#receiveRemark")?.value || ""
    });

    state.receiveCart = [];
    if ($("#receiveDocNo")) $("#receiveDocNo").value = "";
    if ($("#receiveRemark")) $("#receiveRemark").value = "";

    await refreshAfterStockTransaction();
    showToast("รับเข้าเรียบร้อย", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "รับเข้าไม่สำเร็จ", "error");
  } finally {
    state.ready.busy = false;
    setBusyButton("#confirmReceiveBtn", false);
  }
}

async function confirmIssueAll() {
  if (state.ready.busy) return showToast("ระบบกำลังบันทึกรายการก่อนหน้าอยู่", "warn");
  if (!canIssueStock()) return showToast("คุณไม่มีสิทธิ์เบิกสินค้า", "error");
  if (!state.issueCart.length) return showToast("ไม่มีรายการเบิก", "warn");

  const employeeName = state.currentUser?.full_name || $("#issueEmployeeName")?.value || "";
  const employeeId = state.currentUser?.employee_code || $("#issueEmployeeId")?.value || "";
  const department = state.currentUser?.department_code || $("#issueDepartment")?.value || "";
  const machineName = ($("#issueMachineName")?.value || "").trim();
  const reason = ($("#issueReason")?.value || "").trim();
  const remark = ($("#issueRemark")?.value || "").trim();

  if (!machineName) return showToast("กรุณากรอกเครื่องจักร", "error");
  if (!reason) return showToast("กรุณาเลือกเหตุผลการเบิก", "error");

  const validItems = normalizeCartItemsForBatch(state.issueCart, "OUT");
  const totalQty = validItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const machineFullText = [department ? `Dept: ${department}` : "", `Machine: ${machineName}`].filter(Boolean).join(" | ");

  const ok = await iosConfirm(
    "ยืนยันเบิกสินค้า",
    `ผู้เบิก: ${employeeName}\nรหัสพนักงาน: ${employeeId}\nแผนก: ${department || "-"}\nเครื่องจักร: ${machineName}\nเหตุผล: ${reason}\nจำนวนรายการ: ${validItems.length}\nจำนวนรวม: ${numberFormat(totalQty)}\n\nยืนยันการเบิกใช่หรือไม่?`
  );
  if (!ok) return;

  try {
    state.ready.busy = true;
    setBusyButton("#confirmIssueBtn", true, "กำลังเบิก...");

    await rpcStockMoveBatch("OUT", state.issueCart, {
      employee_name: employeeName,
      employee_id: employeeId,
      machine_name: machineFullText,
      document_no: "",
      reason,
      remark: remark ? `Remark: ${remark}` : ""
    });

    state.issueCart = [];
    if ($("#issueMachineName")) $("#issueMachineName").value = "";
    if ($("#issueReason")) $("#issueReason").value = "";
    if ($("#issueRemark")) $("#issueRemark").value = "";

    await refreshAfterStockTransaction();
    showToast("เบิกสินค้าสำเร็จ", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "เบิกสินค้าไม่สำเร็จ", "error");
  } finally {
    state.ready.busy = false;
    setBusyButton("#confirmIssueBtn", false);
  }
}

function compressImageFileToDataUrl(file, maxSize = readyConfig("imageMaxSize"), quality = readyConfig("imageQuality")) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");

    if (file.size > 4 * 1024 * 1024) {
      showToast("รูปมีขนาดใหญ่ ระบบจะบีบอัดเพื่อลดความอืด", "warn");
    }

    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        let { width, height } = img;
        const safeMax = Number(maxSize || 560);

        if (width > safeMax || height > safeMax) {
          if (width >= height) {
            height = Math.round(height * (safeMax / width));
            width = safeMax;
          } else {
            width = Math.round(width * (safeMax / height));
            height = safeMax;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", Number(quality || 0.72)));
      };

      img.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function renderHistory() {
  if (!$("#historyTableBody")) return;

  const allRows = getVisibleHistoryRows();
  const limit = Number(readyConfig("historyRenderLimit") || 600);
  const rows = allRows.slice(0, limit);

  const table = $("#historyTableBody");
  const wrap = table.closest(".table-wrap") || table.parentElement;

  if (wrap && wrap.dataset.readyHistoryNote !== "1") {
    wrap.dataset.readyHistoryNote = "1";
    wrap.insertAdjacentHTML(
      "beforebegin",
      `<div class="history-display-note">แสดงประวัติล่าสุดสูงสุด ${numberFormat(limit)} รายการ เพื่อให้หน้าเว็บไม่อืด ถ้าต้องการข้อมูลทั้งหมดให้กด Export ประวัติทั้งหมด</div>`
    );
  }

  table.innerHTML = rows.map((h) => `
    <tr>
      <td>${formatDate(h.created_at)}</td>
      <td>${safeTxnTypeLabel(h.txn_type)}</td>
      <td>${escapeHtml(h.machine_name || "")}</td>
      <td>${escapeHtml(h.barcode || "")}</td>
      <td>${escapeHtml(h.part_code || "")}</td>
      <td>${escapeHtml(h.part_name || "")}</td>
      <td>${numberFormat(h.qty)}</td>
      <td>${numberFormat(h.before_qty)}</td>
      <td>${numberFormat(h.after_qty)}</td>
      <td>${escapeHtml(h.employee_name || "")}</td>
      <td>${escapeHtml(h.reason || "")}</td>
      <td>${escapeHtml(h.remark || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="12">${isUser() ? "ยังไม่มีประวัติการเบิกของคุณ" : "ยังไม่มีประวัติ"}</td></tr>`;
}

async function fetchAllTransactionsForExport() {
  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const { data, error } = await sb
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
    if (from > 50000) break;
  }

  return all;
}

async function exportAllHistoryToExcel() {
  if (isUser()) return showToast("สิทธิ์ User ดูประวัติได้ แต่ไม่สามารถ Export ประวัติได้", "warn");

  try {
    showToast("กำลังเตรียมไฟล์ประวัติทั้งหมด...", "info");
    const visibleRows = canViewAllHistory() ? await fetchAllTransactionsForExport() : getVisibleHistoryRows();

    if (!visibleRows.length) return showToast("ไม่มีประวัติสำหรับส่งออก", "warn");

    const rows = visibleRows.map((h, index) => ({
      "ลำดับ": index + 1,
      "วันเวลา": formatDate(h.created_at),
      "ประเภท": safeTxnTypeLabel(h.txn_type),
      "เครื่องจักร / แผนก": h.machine_name || "",
      "บาร์โค้ด": h.barcode || "",
      "รหัสอะไหล่": h.part_code || "",
      "ชื่ออะไหล่": h.part_name || "",
      "จำนวน": Number(h.qty || 0),
      "ก่อนทำ": Number(h.before_qty || 0),
      "หลังทำ": Number(h.after_qty || 0),
      "ผู้ทำรายการ": h.employee_name || "",
      "รหัสพนักงาน": h.employee_id || "",
      "เหตุผล": h.reason || "",
      "หมายเหตุ": h.remark || ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = autoFitWorksheetColumns(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ประวัติทั้งหมด");
    XLSX.writeFileXLSX(wb, `ประวัติทั้งหมด_${formatDateForFileName()}.xlsx`);
    showToast("ส่งออกประวัติทั้งหมดเรียบร้อย", "success");
  } catch (err) {
    console.error(err);
    showToast("ส่งออกประวัติไม่สำเร็จ: " + (err.message || err), "error");
  }
}

window.addEventListener("focus", () => {
  const diff = Date.now() - Number(state.ready.lastRefreshAt || 0);
  if (diff > 30000 && state.currentUser) scheduleLightRefresh("window-focus");
});

document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.toggle("ready-low-motion", (state.parts || []).length > 300);
});

/* ---------- Admin soft delete part button ---------- */
const CORESYS_READY_ORIGINAL_OPEN_EDIT_PART_MODAL = openEditPartModal;
openEditPartModal = function(stockBalanceId) {
  CORESYS_READY_ORIGINAL_OPEN_EDIT_PART_MODAL(stockBalanceId);
  injectReadyDeletePartButton(stockBalanceId);
};

function injectReadyDeletePartButton(stockBalanceId) {
  if (!isAdmin()) return;
  const modal = document.querySelector("#addPartModal");
  const actions = modal?.querySelector(".modal-actions");
  const title = document.querySelector("#addPartModalTitle")?.textContent || "";
  if (!modal || !actions || !title.includes("แก้ไข")) return;

  let btn = document.querySelector("#readyDeletePartBtn");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "readyDeletePartBtn";
    btn.type = "button";
    btn.className = "btn delete";
    btn.textContent = "ลบอะไหล่";
    actions.insertBefore(btn, actions.firstChild);
  }

  btn.dataset.stockBalanceId = stockBalanceId;
  btn.onclick = async () => {
    const p = (state.parts || []).find((x) => String(x.stock_balance_id) === String(stockBalanceId));
    if (!p) return showToast("ไม่พบอะไหล่ที่ต้องการลบ", "error");

    const ok = await iosConfirm(
      "ลบอะไหล่",
      `ต้องการลบ/ปิดใช้งานอะไหล่นี้ใช่หรือไม่?\n\n${p.part_code || "-"} : ${p.part_name || "-"}\n\nระบบจะใช้วิธี Soft Delete เพื่อไม่ให้ประวัติเบิก/รับเข้าเดิมหาย`
    );
    if (!ok) return;

    try {
      const { error } = await sb
        .from("parts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", p.part_id);

      if (error) throw error;
      closeAddPartModal();
      await refreshAll();
      showToast("ลบอะไหล่เรียบร้อย", "success");
    } catch (err) {
      console.error(err);
      showToast("ลบอะไหล่ไม่สำเร็จ: " + (err.message || err), "error");
    }
  };
}

nodeReadyPatchLoaded = true;
