const STORAGE_KEY = "shared-entertainment-control";

const seedData = {
  accounts: [
    { id: crypto.randomUUID(), service: "Spotify", name: "Cuenta 1", country: "El Salvador", cost: 12.99 },
    { id: crypto.randomUUID(), service: "Disney+", name: "Cuenta familiar", country: "Estados Unidos", cost: 13.99 },
  ],
  people: [],
};

let state = { accounts: [], people: [] };
let db = null;
let authUser = null;
let isMember = false;
const els = {
  viewTitle: document.querySelector("#viewTitle"),
  navTabs: document.querySelectorAll(".nav-tab"),
  views: {
    dashboard: document.querySelector("#dashboardView"),
    accounts: document.querySelector("#accountsView"),
    people: document.querySelector("#peopleView"),
  },
  monthlyTotal: document.querySelector("#monthlyTotal"),
  subscriptionTotal: document.querySelector("#subscriptionTotal"),
  dueSoon: document.querySelector("#dueSoon"),
  paymentList: document.querySelector("#paymentList"),
  peopleList: document.querySelector("#peopleList"),
  accountList: document.querySelector("#accountList"),
  accountForm: document.querySelector("#accountForm"),
  personForm: document.querySelector("#personForm"),
  personModal: document.querySelector("#personModal"),
  searchInput: document.querySelector("#searchInput"),
  statusFilter: document.querySelector("#statusFilter"),
  loginView: document.querySelector("#loginView"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  authMessage: document.querySelector("#authMessage"),
  authPanel: document.querySelector("#authPanel"),
  authEmailDisplay: document.querySelector("#authEmailDisplay"),
  logoutButton: document.querySelector("#logoutButton"),
  signupButton: document.querySelector("#signupButton"),
};

document.querySelector("#openPersonModal").addEventListener("click", () => openPersonModal());
document.querySelector("#closePersonModal").addEventListener("click", closePersonModal);
document.querySelector("#cancelPerson").addEventListener("click", closePersonModal);
els.searchInput.addEventListener("input", render);
els.statusFilter.addEventListener("change", render);
els.loginForm.addEventListener("submit", signIn);
els.signupButton.addEventListener("click", signUp);
els.logoutButton.addEventListener("click", signOut);

els.navTabs.forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

els.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#accountId").value || crypto.randomUUID();
  const existing = state.accounts.find((account) => account.id === id);
  const payload = {
    id,
    service: document.querySelector("#accountService").value.trim(),
    name: document.querySelector("#accountName").value.trim(),
    country: document.querySelector("#accountCountry").value.trim(),
    cost: Number(document.querySelector("#accountCost").value || 0),
  };

  if (db) {
    await upsertAccount(payload);
    state = await loadState();
  } else {
    if (existing) Object.assign(existing, payload);
    else state.accounts.push(payload);
    saveState();
  }

  els.accountForm.reset();
  document.querySelector("#accountId").value = "";
  render();
});

els.personForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#personId").value || crypto.randomUUID();
  const existing = state.people.find((person) => person.id === id);
  const payload = {
    id,
    name: document.querySelector("#personName").value.trim(),
    phone: normalizePhone(document.querySelector("#personPhone").value),
    accountId: document.querySelector("#personAccount").value,
    recommendedBy: document.querySelector("#personRecommendedBy").value.trim(),
    payDay: clampPayDay(Number(document.querySelector("#personPayDay").value)),
    amount: Number(document.querySelector("#personAmount").value || 0),
    paidUntil: document.querySelector("#personPaidUntil").value,
    note: document.querySelector("#personNote").value.trim(),
  };

  if (db) {
    await upsertPerson(payload);
    state = await loadState();
  } else {
    if (existing) Object.assign(existing, payload);
    else state.people.push(payload);
    saveState();
  }

  closePersonModal();
  render();
});

init();

async function init() {
  db = createDatabaseClient();
  if (db) {
    const { data } = await db.auth.getSession();
    authUser = data.session?.user || null;
    isMember = authUser ? await checkMembership() : false;

    db.auth.onAuthStateChange(async (_event, session) => {
      authUser = session?.user || null;
      isMember = authUser ? await checkMembership() : false;
      state = authUser && isMember ? await loadState() : { accounts: [], people: [] };
      renderAuth();
      render();
    });
  }

  state = await loadState();
  renderAuth();
  render();
  registerServiceWorker();
}

async function loadState() {
  if (db && (!authUser || !isMember)) return { accounts: [], people: [] };

  if (db) {
    try {
      const [{ data: accounts, error: accountsError }, { data: people, error: peopleError }] = await Promise.all([
        db.from("accounts").select("*").order("service", { ascending: true }),
        db.from("people").select("*").order("name", { ascending: true }),
      ]);

      if (accountsError || peopleError) throw accountsError || peopleError;

      return {
        accounts: accounts.map(fromDbAccount),
        people: people.map(fromDbPerson),
      };
    } catch (error) {
      console.warn("No se pudo conectar a Supabase. Usando datos locales.", error);
    }
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return seedData;

  try {
    const parsed = JSON.parse(stored);
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : seedData.accounts,
      people: Array.isArray(parsed.people) ? parsed.people : [],
    };
  } catch {
    return seedData;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function createDatabaseClient() {
  const config = window.SUPABASE_CONFIG || {};
  const hasConfig = config.url && config.anonKey && !config.url.includes("TU-PROYECTO") && !config.anonKey.includes("TU-ANON-KEY");
  if (!hasConfig || !window.supabase) return null;
  return window.supabase.createClient(config.url, config.anonKey);
}

async function signIn(event) {
  event.preventDefault();
  setAuthMessage("Entrando...");
  const { error } = await db.auth.signInWithPassword({
    email: els.loginEmail.value.trim(),
    password: els.loginPassword.value,
  });

  if (error) setAuthMessage(error.message);
}

async function signUp() {
  setAuthMessage("Creando acceso...");
  const { error } = await db.auth.signUp({
    email: els.loginEmail.value.trim(),
    password: els.loginPassword.value,
  });

  if (error) {
    setAuthMessage(error.message);
    return;
  }

  setAuthMessage("Revisa tu correo para confirmar la cuenta. Si ya está confirmada, intenta entrar.");
}

async function signOut() {
  await db.auth.signOut();
}

async function checkMembership() {
  const email = authUser?.email;
  if (!email) return false;

  const { data, error } = await db.from("app_members").select("email").eq("email", email.toLowerCase()).maybeSingle();
  if (error) {
    console.warn("No se pudo verificar el permiso del usuario.", error);
    return false;
  }

  return Boolean(data);
}

function renderAuth() {
  const requiresAuth = document.querySelectorAll(".requires-auth");
  const shouldLogin = Boolean(db && (!authUser || !isMember));

  els.loginView.hidden = !shouldLogin;
  els.authPanel.hidden = !db || !authUser || !isMember;
  requiresAuth.forEach((item) => {
    item.hidden = shouldLogin;
  });

  if (!db) {
    setAuthMessage("");
    return;
  }

  if (authUser && isMember) {
    els.authEmailDisplay.textContent = authUser.email;
    setAuthMessage("");
    return;
  }

  if (authUser && !isMember) {
    setAuthMessage("Este correo inició sesión, pero no está autorizado para ver estos datos.");
  }
}

function setAuthMessage(message) {
  els.authMessage.textContent = message;
}

async function upsertAccount(account) {
  const { error } = await db.from("accounts").upsert(toDbAccount(account));
  if (error) throw error;
}

async function upsertPerson(person) {
  const { error } = await db.from("people").upsert(toDbPerson(person));
  if (error) throw error;
}

async function deleteAccountRecord(id) {
  const { error } = await db.from("accounts").delete().eq("id", id);
  if (error) throw error;
}

async function deletePersonRecord(id) {
  const { error } = await db.from("people").delete().eq("id", id);
  if (error) throw error;
}

function toDbAccount(account) {
  return {
    id: account.id,
    service: account.service,
    name: account.name,
    country: account.country,
    cost: account.cost,
  };
}

function fromDbAccount(account) {
  return {
    id: account.id,
    service: account.service,
    name: account.name,
    country: account.country || "",
    cost: Number(account.cost || 0),
  };
}

function toDbPerson(person) {
  return {
    id: person.id,
    name: person.name,
    phone: person.phone,
    account_id: person.accountId,
    recommended_by: person.recommendedBy,
    pay_day: person.payDay,
    amount: person.amount,
    paid_until: person.paidUntil || null,
    last_payment_at: person.lastPaymentAt || null,
    note: person.note,
  };
}

function fromDbPerson(person) {
  return {
    id: person.id,
    name: person.name,
    phone: person.phone || "",
    accountId: person.account_id,
    recommendedBy: person.recommended_by || "",
    payDay: Number(person.pay_day || 1),
    amount: Number(person.amount || 0),
    paidUntil: person.paid_until || "",
    lastPaymentAt: person.last_payment_at || "",
    note: person.note || "",
  };
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch((error) => {
    console.warn("No se pudo registrar el modo instalable.", error);
  });
}

function setView(view) {
  els.navTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  Object.entries(els.views).forEach(([name, section]) => section.classList.toggle("active", name === view));
  els.viewTitle.textContent = { dashboard: "Inicio", accounts: "Cuentas", people: "Personas" }[view];
}

function render() {
  renderSummary();
  renderAccountOptions();
  renderPayments();
  renderAccounts();
  renderPeople();
}

function renderSummary() {
  const clientTotal = state.people.reduce((sum, person) => sum + Number(person.amount || 0), 0);
  const subscriptionTotal = state.accounts.reduce((sum, account) => sum + Number(account.cost || 0), 0);
  els.monthlyTotal.textContent = currency(clientTotal);
  els.subscriptionTotal.textContent = currency(subscriptionTotal);
  els.dueSoon.textContent = state.people.filter((person) => {
    const status = paymentStatus(person);
    return status.key === "due" || status.key === "late";
  }).length;
}

function renderAccountOptions() {
  const select = document.querySelector("#personAccount");
  select.innerHTML = state.accounts
    .map((account) => `<option value="${account.id}">${escapeHtml(account.service)} - ${escapeHtml(account.name)}</option>`)
    .join("");
}

function renderPayments() {
  const query = els.searchInput.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  const people = state.people
    .map((person) => ({ ...person, account: findAccount(person.accountId), status: paymentStatus(person) }))
    .filter((person) => {
      const searchable = `${person.name} ${person.phone} ${person.recommendedBy} ${person.account.service} ${person.account.name}`.toLowerCase();
      const matchesQuery = !query || searchable.includes(query);
      const matchesStatus = status === "all" || person.status.key === status;
      return matchesQuery && matchesStatus;
    })
    .sort((a, b) => a.status.nextDate - b.status.nextDate);

  els.paymentList.innerHTML = people.length
    ? people.map(paymentCard).join("")
    : `<div class="empty">Aún no hay pagos para mostrar. Agrega una persona para comenzar.</div>`;

  bindPersonActions(els.paymentList);
}

function paymentCard(person) {
  const message = buildWhatsappMessage(person);
  const whatsappUrl = person.phone ? `https://wa.me/${person.phone}?text=${encodeURIComponent(message)}` : "";
  return `
    <article class="payment-card">
      <div>
        <div class="card-title">
          <strong>${escapeHtml(person.name)}</strong>
          <span class="badge ${person.status.key}">${person.status.label}</span>
        </div>
        <div class="meta">
          <span>${escapeHtml(person.account.service)} · ${escapeHtml(person.account.name)}</span>
          <span>Pago: ${formatDate(person.status.nextDate)}</span>
          <span>Monto: ${currency(person.amount)}</span>
          <span>Recomendó: ${escapeHtml(person.recommendedBy || "Sin dato")}</span>
          ${person.paidUntil ? `<span>Pagado hasta: ${formatDate(parseStoredDate(person.paidUntil))}</span>` : ""}
        </div>
      </div>
      <div class="card-actions">
        ${person.phone ? `<a class="whatsapp-btn" href="${whatsappUrl}" target="_blank" rel="noreferrer">WhatsApp</a>` : ""}
        <button class="success-btn" type="button" data-confirm-payment="${person.id}">Confirmar pago</button>
        <button class="secondary-btn" type="button" data-edit-person="${person.id}">Editar</button>
        <button class="danger-btn" type="button" data-delete-person="${person.id}">Eliminar</button>
      </div>
    </article>
  `;
}

function renderAccounts() {
  els.accountList.innerHTML = state.accounts.length
    ? state.accounts.map(accountCard).join("")
    : `<div class="empty">Agrega tu primera cuenta compartida.</div>`;

  els.accountList.querySelectorAll("[data-edit-account]").forEach((button) => {
    button.addEventListener("click", () => editAccount(button.dataset.editAccount));
  });

  els.accountList.querySelectorAll("[data-delete-account]").forEach((button) => {
    button.addEventListener("click", () => deleteAccount(button.dataset.deleteAccount));
  });
}

function accountCard(account) {
  const members = state.people.filter((person) => person.accountId === account.id).length;
  return `
    <article class="account-card">
      <div>
        <div class="card-title">
          <strong>${escapeHtml(account.service)} · ${escapeHtml(account.name)}</strong>
        </div>
        <div class="meta">
          <span>Pais: ${escapeHtml(account.country || "Sin dato")}</span>
          <span>Costo mensual: ${currency(account.cost)}</span>
          <span>Personas asignadas: ${members}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="secondary-btn" type="button" data-edit-account="${account.id}">Editar</button>
        <button class="danger-btn" type="button" data-delete-account="${account.id}">Eliminar</button>
      </div>
    </article>
  `;
}

function renderPeople() {
  els.peopleList.innerHTML = state.people.length
    ? state.people.map(personCard).join("")
    : `<div class="empty">No hay personas registradas todavía.</div>`;

  bindPersonActions(els.peopleList);
}

function personCard(person) {
  const account = findAccount(person.accountId);
  const status = paymentStatus(person);
  return `
    <article class="person-card">
      <div>
        <div class="card-title">
          <strong>${escapeHtml(person.name)}</strong>
          <span class="badge ${status.key}">${status.label}</span>
          <span class="badge paid">${currency(person.amount)}</span>
        </div>
        <div class="meta">
          <span>${escapeHtml(account.service)} · ${escapeHtml(account.name)}</span>
          <span>WhatsApp: ${escapeHtml(person.phone || "Sin número")}</span>
          <span>Día ${person.payDay} de cada mes</span>
          <span>Próximo pago: ${formatDate(status.nextDate)}</span>
          <span>Recomendó: ${escapeHtml(person.recommendedBy || "Sin dato")}</span>
          ${person.paidUntil ? `<span>Pagado hasta: ${formatDate(parseStoredDate(person.paidUntil))}</span>` : ""}
          ${person.note ? `<span>Nota: ${escapeHtml(person.note)}</span>` : ""}
        </div>
      </div>
      <div class="card-actions">
        <button class="success-btn" type="button" data-confirm-payment="${person.id}">Confirmar pago</button>
        <button class="secondary-btn" type="button" data-edit-person="${person.id}">Editar</button>
        <button class="danger-btn" type="button" data-delete-person="${person.id}">Eliminar</button>
      </div>
    </article>
  `;
}

function bindPersonActions(container) {
  container.querySelectorAll("[data-confirm-payment]").forEach((button) => {
    button.addEventListener("click", () => confirmPayment(button.dataset.confirmPayment));
  });

  container.querySelectorAll("[data-edit-person]").forEach((button) => {
    button.addEventListener("click", () => openPersonModal(button.dataset.editPerson));
  });

  container.querySelectorAll("[data-delete-person]").forEach((button) => {
    button.addEventListener("click", async () => {
      const person = state.people.find((item) => item.id === button.dataset.deletePerson);
      if (!person || !confirm(`Eliminar a ${person.name}?`)) return;

      if (db) {
        await deletePersonRecord(person.id);
        state = await loadState();
      } else {
        state.people = state.people.filter((item) => item.id !== person.id);
        saveState();
      }

      render();
    });
  });
}

function editAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;
  document.querySelector("#accountId").value = account.id;
  document.querySelector("#accountService").value = account.service;
  document.querySelector("#accountName").value = account.name;
  document.querySelector("#accountCountry").value = account.country || "";
  document.querySelector("#accountCost").value = account.cost;
}

async function deleteAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  const hasPeople = state.people.some((person) => person.accountId === id);
  if (hasPeople) {
    alert("Primero mueve o elimina las personas asignadas a esta cuenta.");
    return;
  }

  if (!confirm(`Eliminar ${account.service} - ${account.name}?`)) return;
  if (db) {
    await deleteAccountRecord(id);
    state = await loadState();
  } else {
    state.accounts = state.accounts.filter((item) => item.id !== id);
    saveState();
  }
  render();
}

function openPersonModal(id) {
  if (!state.accounts.length) {
    setView("accounts");
    alert("Agrega una cuenta antes de registrar personas.");
    return;
  }

  const person = state.people.find((item) => item.id === id);
  document.querySelector("#personModalTitle").textContent = person ? "Editar persona" : "Agregar persona";
  document.querySelector("#personId").value = person?.id || "";
  document.querySelector("#personName").value = person?.name || "";
  document.querySelector("#personPhone").value = person?.phone || "";
  document.querySelector("#personAccount").value = person?.accountId || state.accounts[0].id;
  document.querySelector("#personRecommendedBy").value = person?.recommendedBy || "";
  document.querySelector("#personPayDay").value = person?.payDay || 1;
  document.querySelector("#personAmount").value = person?.amount || "";
  document.querySelector("#personPaidUntil").value = person?.paidUntil || "";
  document.querySelector("#personNote").value = person?.note || "";
  els.personModal.showModal();
}

function closePersonModal() {
  els.personModal.close();
  els.personForm.reset();
}

function findAccount(id) {
  return state.accounts.find((account) => account.id === id) || { service: "Sin cuenta", name: "No asignada", cost: 0 };
}

function paymentStatus(person) {
  const today = startOfDay(new Date());
  const paidUntil = parseStoredDate(person.paidUntil);
  const nextDate = paidUntil && paidUntil > today ? paidUntil : nextPaymentDate(person.payDay, today);
  const diffDays = Math.ceil((nextDate - today) / 86400000);

  if (diffDays === 0) return { key: "due", label: "Vence hoy", nextDate };
  if (diffDays <= 7) return { key: "due", label: `Faltan ${diffDays} días`, nextDate };

  if (paidUntil && paidUntil < today) {
    const daysLate = Math.floor((today - paidUntil) / 86400000);
    return { key: "late", label: `${daysLate} días tarde`, nextDate: paidUntil };
  }

  const lastDate = previousPaymentDate(person.payDay, today);
  if (!paidUntil && lastDate < today && today.getDate() > person.payDay) {
    const daysLate = Math.floor((today - lastDate) / 86400000);
    return { key: "late", label: `${daysLate} días tarde`, nextDate: lastDate };
  }

  return { key: "paid", label: "Al día", nextDate };
}

async function confirmPayment(id) {
  const person = state.people.find((item) => item.id === id);
  if (!person) return;

  const months = Number(prompt(`Cuántos meses pagó ${person.name}?`, "1"));
  if (!Number.isInteger(months) || months < 1) {
    alert("Ingresa un número de meses válido.");
    return;
  }

  const today = startOfDay(new Date());
  const currentPaidUntil = parseStoredDate(person.paidUntil);
  const baseDate = currentPaidUntil || openPaymentDate(person.payDay, today);
  const paidUntil = addMonthsKeepingPayDay(baseDate, months, person.payDay);
  person.paidUntil = dateToInputValue(paidUntil);
  person.lastPaymentAt = dateToInputValue(today);

  if (db) {
    await upsertPerson(person);
    state = await loadState();
  } else {
    saveState();
  }

  render();
}

function nextPaymentDate(day, fromDate) {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const currentMonthDay = Math.min(day, daysInMonth(year, month));
  const candidate = new Date(year, month, currentMonthDay);
  if (candidate >= fromDate) return candidate;

  const nextMonth = month + 1;
  return new Date(year, nextMonth, Math.min(day, daysInMonth(year, nextMonth)));
}

function previousPaymentDate(day, fromDate) {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const currentMonthDay = Math.min(day, daysInMonth(year, month));
  const candidate = new Date(year, month, currentMonthDay);
  if (candidate < fromDate) return candidate;

  const previousMonth = month - 1;
  return new Date(year, previousMonth, Math.min(day, daysInMonth(year, previousMonth)));
}

function openPaymentDate(day, fromDate) {
  const lastDate = previousPaymentDate(day, fromDate);
  return lastDate < fromDate && fromDate.getDate() > day ? lastDate : nextPaymentDate(day, fromDate);
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function addMonthsKeepingPayDay(date, months, payDay) {
  const year = date.getFullYear();
  const targetMonth = date.getMonth() + months;
  return new Date(year, targetMonth, Math.min(payDay, daysInMonth(year, targetMonth)));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseStoredDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return startOfDay(new Date(year, month - 1, day));
}

function dateToInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildWhatsappMessage(person) {
  const account = findAccount(person.accountId);
  const due = formatDate(paymentStatus(person).nextDate);
  return `Hola ${person.name}, te recuerdo el pago de ${account.service} (${account.name}) por ${currency(person.amount)}. Fecha de pago: ${due}. Gracias.`;
}

function normalizePhone(value) {
  return value.replace(/[^\d]/g, "");
}

function clampPayDay(value) {
  if (Number.isNaN(value)) return 1;
  return Math.min(31, Math.max(1, value));
}

function currency(value) {
  return new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function formatDate(date) {
  return new Intl.DateTimeFormat("es-SV", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
