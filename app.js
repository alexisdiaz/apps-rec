const STORAGE_KEY = "shared-entertainment-control";
const DB_TIMEOUT_MS = 15000;
const SESSION_REFRESH_MARGIN_SECONDS = 120;

const seedData = {
  accounts: [
    { id: crypto.randomUUID(), service: "Spotify", name: "Cuenta 1", country: "El Salvador", cost: 12.99, payDay: 1 },
    { id: crypto.randomUUID(), service: "Disney+", name: "Cuenta familiar", country: "Estados Unidos", cost: 13.99, payDay: 15 },
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
  personFormMessage: document.querySelector("#personFormMessage"),
  personSubmitButton: document.querySelector("#personSubmitButton"),
  personAccounts: document.querySelector("#personAccounts"),
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
els.personAccounts.addEventListener("change", updatePersonAmountFromSelection);
document.querySelector("#personDiscount").addEventListener("input", updatePersonAmountFromSelection);
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
    profilePrice: Number(document.querySelector("#accountProfilePrice").value || 0),
    payDay: clampPayDay(Number(document.querySelector("#accountPayDay").value)),
    profileNames: parseProfileNames(document.querySelector("#accountProfileNames").value),
  };

  setFormBusy(els.accountForm, true);
  try {
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
  } catch (error) {
    alert(`No se pudo guardar la cuenta: ${getErrorMessage(error)}`);
  } finally {
    setFormBusy(els.accountForm, false);
  }
});

els.personForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setPersonMessage("Guardando...");
  els.personSubmitButton.disabled = true;
  const id = document.querySelector("#personId").value || crypto.randomUUID();
  const existing = state.people.find((person) => person.id === id);
  const accountIds = getSelectedPersonAccountIds();
  const accountProfiles = getSelectedPersonProfiles();
  if (!accountIds.length) {
    setPersonMessage("Selecciona al menos una cuenta.");
    els.personSubmitButton.disabled = false;
    return;
  }

  const payload = {
    id,
    name: document.querySelector("#personName").value.trim(),
    phone: normalizePhone(document.querySelector("#personPhone").value),
    accountId: accountIds[0],
    accountIds,
    accountProfiles,
    recommendedBy: document.querySelector("#personRecommendedBy").value.trim(),
    payDay: clampPayDay(Number(document.querySelector("#personPayDay").value)),
    amount: Number(document.querySelector("#personAmount").value || 0),
    discount: Number(document.querySelector("#personDiscount").value || 0),
    paidUntil: document.querySelector("#personPaidUntil").value,
    note: document.querySelector("#personNote").value.trim(),
  };

  try {
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
  } catch (error) {
    setPersonMessage(`No se pudo guardar: ${getErrorMessage(error)}`);
  } finally {
    els.personSubmitButton.disabled = false;
  }
});

init();

async function init() {
  db = createDatabaseClient();
  if (db) {
    const { data } = await withTimeout(db.auth.getSession(), "No se pudo verificar la sesion.");
    authUser = data.session?.user || null;
    isMember = authUser ? await checkMembership() : false;

    db.auth.onAuthStateChange(async (_event, session) => {
      authUser = session?.user || null;
      isMember = authUser ? await checkMembership() : false;
      try {
        state = authUser && isMember ? await loadState() : { accounts: [], people: [] };
      } catch (error) {
        console.warn("No se pudieron actualizar los datos despues del cambio de sesion.", error);
        alert(`No se pudieron actualizar los datos: ${getErrorMessage(error)}`);
      }
      renderAuth();
      render();
    });
  }

  try {
    state = await loadState();
  } catch (error) {
    console.warn("No se pudieron cargar los datos iniciales.", error);
    alert(`No se pudieron cargar los datos: ${getErrorMessage(error)}`);
  }
  renderAuth();
  render();
  registerServiceWorker();
}

async function loadState() {
  if (db && (!authUser || !isMember)) return { accounts: [], people: [] };

  if (db) {
    const [{ data: accounts, error: accountsError }, { data: people, error: peopleError }] = await Promise.all([
      runDbQuery(() => db.from("accounts").select("*").order("service", { ascending: true }), "No se pudieron cargar las cuentas."),
      runDbQuery(() => db.from("people").select("*").order("name", { ascending: true }), "No se pudieron cargar las personas."),
    ]);

    if (accountsError || peopleError) throw accountsError || peopleError;

    return {
      accounts: accounts.map(fromDbAccount),
      people: people.map(fromDbPerson),
    };
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
  let error = null;
  try {
    ({ error } = await withTimeout(
      db.auth.signInWithPassword({
        email: els.loginEmail.value.trim(),
        password: els.loginPassword.value,
      }),
      "No se pudo iniciar sesion.",
    ));
  } catch (caughtError) {
    error = caughtError;
  }

  if (error) setAuthMessage(error.message);
}

async function signUp() {
  setAuthMessage("Creando acceso...");
  let error = null;
  try {
    ({ error } = await withTimeout(
      db.auth.signUp({
        email: els.loginEmail.value.trim(),
        password: els.loginPassword.value,
      }),
      "No se pudo crear el acceso.",
    ));
  } catch (caughtError) {
    error = caughtError;
  }

  if (error) {
    setAuthMessage(error.message);
    return;
  }

  setAuthMessage("Revisa tu correo para confirmar la cuenta. Si ya está confirmada, intenta entrar.");
}

async function signOut() {
  await withTimeout(db.auth.signOut(), "No se pudo cerrar sesion.");
}

async function checkMembership(options = {}) {
  const email = authUser?.email;
  if (!email) return false;

  const query = () => db.from("app_members").select("email").eq("email", email.toLowerCase()).maybeSingle();
  const { data, error } = options.skipSessionCheck
    ? await withTimeout(query(), "No se pudo verificar el permiso del usuario.")
    : await runDbQuery(query, "No se pudo verificar el permiso del usuario.");
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

async function runDbQuery(queryFactory, timeoutMessage) {
  await ensureActiveSession();

  try {
    return await withTimeout(queryFactory(), timeoutMessage);
  } catch (error) {
    if (!isSessionError(error)) throw error;
    await refreshActiveSession();
    return withTimeout(queryFactory(), timeoutMessage);
  }
}

async function ensureActiveSession() {
  if (!db) return;

  const { data, error } = await withTimeout(db.auth.getSession(), "No se pudo verificar la sesion.");
  if (error) throw error;

  let session = data.session;
  if (!session) {
    authUser = null;
    isMember = false;
    renderAuth();
    throw new Error("Tu sesion expiro. Inicia sesion de nuevo y vuelve a guardar.");
  }

  const secondsLeft = Number(session.expires_at || 0) - Math.floor(Date.now() / 1000);
  if (session.expires_at && secondsLeft < SESSION_REFRESH_MARGIN_SECONDS) {
    session = await refreshActiveSession();
  }

  authUser = session.user;
  isMember = await checkMembership({ skipSessionCheck: true });
  renderAuth();

  if (!isMember) {
    throw new Error("Este usuario ya no tiene permiso para modificar los datos.");
  }
}

async function refreshActiveSession() {
  const { data, error } = await withTimeout(db.auth.refreshSession(), "No se pudo renovar la sesion.");
  if (error) throw error;
  if (!data.session) throw new Error("Tu sesion expiro. Inicia sesion de nuevo y vuelve a guardar.");
  authUser = data.session.user;
  return data.session;
}

function withTimeout(promise, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${message} Revisa tu conexion e intenta otra vez.`)), DB_TIMEOUT_MS);
    }),
  ]);
}

function isSessionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("jwt") || message.includes("token") || message.includes("session") || message.includes("auth");
}

async function upsertAccount(account) {
  const dbAccount = toDbAccount(account);
  const { data, error } = await runDbQuery(
    () => db.from("accounts").upsert(dbAccount, { onConflict: "id" }).select("id,pay_day").single(),
    "No se pudo guardar la cuenta.",
  );

  if (error) throw error;
  if (Number(data?.pay_day) !== Number(dbAccount.pay_day)) {
    throw new Error("Supabase no devolvio el dia de pago guardado. Revisa que la columna pay_day exista y vuelve a ejecutar database.sql.");
  }
}

async function upsertPerson(person) {
  const { error } = await runDbQuery(
    () => db.from("people").upsert(toDbPerson(person), { onConflict: "id" }),
    "No se pudo guardar la persona.",
  );
  if (error) throw error;
}

async function deleteAccountRecord(id) {
  const { error } = await runDbQuery(() => db.from("accounts").delete().eq("id", id), "No se pudo eliminar la cuenta.");
  if (error) throw error;
}

async function deletePersonRecord(id) {
  const { error } = await runDbQuery(() => db.from("people").delete().eq("id", id), "No se pudo eliminar la persona.");
  if (error) throw error;
}

function toDbAccount(account) {
  return {
    id: account.id,
    service: account.service,
    name: account.name,
    country: account.country,
    cost: account.cost,
    profile_price: account.profilePrice,
    profile_names: account.profileNames || [],
    pay_day: account.payDay,
  };
}

function fromDbAccount(account) {
  return {
    id: account.id,
    service: account.service,
    name: account.name,
    country: account.country || "",
    cost: Number(account.cost || 0),
    profilePrice: Number(account.profile_price || 0),
    profileNames: Array.isArray(account.profile_names) ? account.profile_names : [],
    payDay: Number(account.pay_day || 1),
  };
}

function toDbPerson(person) {
  return {
    id: person.id,
    name: person.name,
    phone: person.phone,
    account_id: person.accountId,
    account_ids: person.accountIds || [person.accountId],
    account_profiles: person.accountProfiles || {},
    recommended_by: person.recommendedBy,
    pay_day: person.payDay,
    amount: person.amount,
    discount: person.discount || 0,
    paid_until: person.paidUntil || null,
    last_payment_at: person.lastPaymentAt || null,
    note: person.note,
  };
}

function fromDbPerson(person) {
  const accountIds = normalizeAccountIds(person.account_ids, person.account_id);
  return {
    id: person.id,
    name: person.name,
    phone: person.phone || "",
    accountId: accountIds[0] || person.account_id,
    accountIds,
    accountProfiles: person.account_profiles || {},
    recommendedBy: person.recommended_by || "",
    payDay: Number(person.pay_day || 1),
    amount: Number(person.amount || 0),
    discount: Number(person.discount || 0),
    paidUntil: person.paid_until || "",
    lastPaymentAt: person.last_payment_at || "",
    note: person.note || "",
  };
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js?v=9").catch((error) => {
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
  els.personAccounts.innerHTML = state.accounts
    .map(
      (account) => `
        <div class="account-option" data-account-option="${account.id}">
          <label class="account-option-check">
            <input type="checkbox" value="${account.id}" data-account-checkbox />
            <span>${escapeHtml(accountLabel(account))}</span>
          </label>
          <div class="profile-picker" data-profile-for="${account.id}" hidden>
            ${
              (account.profileNames || []).length
                ? account.profileNames
                    .map(
                      (name) => `
                        <label class="profile-option">
                          <input type="checkbox" value="${escapeHtml(name)}" />
                          <span>${escapeHtml(name)}</span>
                        </label>
                      `,
                    )
                    .join("")
                : `<span class="profile-empty">Sin usuarios registrados</span>`
            }
          </div>
        </div>
      `,
    )
    .join("");
}

function renderPayments() {
  const query = els.searchInput.value.trim().toLowerCase();
  const status = els.statusFilter.value;
  const people = state.people
    .map((person) => ({ ...person, accounts: findAccounts(person.accountIds || person.accountId), status: paymentStatus(person) }))
    .filter((person) => {
      const accountText = person.accounts.map((account) => accountAssignmentLabel(account, person.accountProfiles)).join(" ");
      const searchable = `${person.name} ${person.phone} ${person.recommendedBy} ${accountText}`.toLowerCase();
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
  const accountsLabel = accountListLabel(person.accounts, person.accountProfiles);
  return `
    <article class="payment-card">
      <div>
        <div class="card-title">
          <strong>${escapeHtml(person.name)}</strong>
          <span class="badge ${person.status.key}">${person.status.label}</span>
        </div>
        <div class="meta">
          <span>${escapeHtml(accountsLabel)}</span>
          <span>Pago: ${formatDate(person.status.nextDate)}</span>
          <span>Monto: ${currency(person.amount)}</span>
          ${person.discount ? `<span>Descuento: ${currency(person.discount)}</span>` : ""}
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
  const members = state.people.filter((person) => normalizeAccountIds(person.accountIds, person.accountId).includes(account.id)).length;
  const nextPayment = nextPaymentDate(account.payDay || 1, startOfDay(new Date()));
  return `
    <article class="account-card">
      <div>
        <div class="card-title">
          <strong>${escapeHtml(account.service)} - ${escapeHtml(account.name)}</strong>
        </div>
        <div class="meta">
          <span>Pais: ${escapeHtml(account.country || "Sin dato")}</span>
          <span>Costo mensual: ${currency(account.cost)}</span>
          <span>Precio por perfil: ${currency(account.profilePrice)}</span>
          <span>Usuarios: ${escapeHtml((account.profileNames || []).join(", ") || "Sin dato")}</span>
          <span>Dia de pago: ${account.payDay || 1}</span>
          <span>Proximo pago: ${formatDate(nextPayment)}</span>
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
  const accounts = findAccounts(person.accountIds || person.accountId);
  const accountsLabel = accountListLabel(accounts, person.accountProfiles);
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
          <span>${escapeHtml(accountsLabel)}</span>
          <span>WhatsApp: ${escapeHtml(person.phone || "Sin número")}</span>
          <span>Día ${person.payDay} de cada mes</span>
          <span>Próximo pago: ${formatDate(status.nextDate)}</span>
          ${person.discount ? `<span>Descuento: ${currency(person.discount)}</span>` : ""}
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
  document.querySelector("#accountProfilePrice").value = account.profilePrice || "";
  document.querySelector("#accountPayDay").value = account.payDay || 1;
  document.querySelector("#accountProfileNames").value = (account.profileNames || []).join("\n");
}

async function deleteAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  const hasPeople = state.people.some((person) => normalizeAccountIds(person.accountIds, person.accountId).includes(id));
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
  setSelectedPersonAccounts(person?.accountIds || (person?.accountId ? [person.accountId] : [state.accounts[0].id]), person?.accountProfiles || {});
  document.querySelector("#personRecommendedBy").value = person?.recommendedBy || "";
  document.querySelector("#personPayDay").value = person?.payDay || 1;
  document.querySelector("#personAmount").value = person?.amount || "";
  document.querySelector("#personDiscount").value = person?.discount || 0;
  document.querySelector("#personPaidUntil").value = person?.paidUntil || "";
  document.querySelector("#personNote").value = person?.note || "";
  updatePersonAmountFromSelection();
  setPersonMessage("");
  els.personModal.showModal();
}

function closePersonModal() {
  els.personModal.close();
  els.personForm.reset();
  setPersonMessage("");
}

function findAccount(id) {
  return state.accounts.find((account) => account.id === id) || { service: "Sin cuenta", name: "No asignada", cost: 0 };
}

function findAccounts(ids) {
  const accounts = normalizeAccountIds(ids).map(findAccount).filter((account) => account.service !== "Sin cuenta");
  return accounts.length ? accounts : [findAccount(null)];
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

  try {
    if (db) {
      await upsertPerson(person);
      state = await loadState();
    } else {
      saveState();
    }

    render();
  } catch (error) {
    alert(`No se pudo confirmar el pago: ${getErrorMessage(error)}`);
  }
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
  const accounts = findAccounts(person.accountIds || person.accountId);
  const due = formatDate(paymentStatus(person).nextDate);
  return `Hola ${person.name}, te recuerdo el pago de ${accountListLabel(accounts, person.accountProfiles)} por ${currency(person.amount)}. Fecha de pago: ${due}. Gracias.`;
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

function getSelectedPersonAccountIds() {
  return Array.from(els.personAccounts.querySelectorAll("[data-account-checkbox]:checked")).map((input) => input.value);
}

function getSelectedPersonProfiles() {
  return getSelectedPersonAccountIds().reduce((profiles, accountId) => {
    const selectedProfiles = getSelectedProfilesForAccount(accountId);
    if (selectedProfiles.length) profiles[accountId] = selectedProfiles;
    return profiles;
  }, {});
}

function setSelectedPersonAccounts(ids, profiles = {}) {
  const selected = new Set(normalizeAccountIds(ids));
  els.personAccounts.querySelectorAll("[data-account-checkbox]").forEach((input) => {
    input.checked = selected.has(input.value);
    setSelectedProfilesForAccount(input.value, profiles[input.value]);
  });
  syncAccountProfileControls();
}

function updatePersonAmountFromSelection() {
  syncAccountProfileControls();
  const selectedAccounts = findAccounts(getSelectedPersonAccountIds()).filter((account) => account.service !== "Sin cuenta");
  const subtotal = selectedAccounts.reduce((sum, account) => sum + Number(account.profilePrice || 0) * getBillableProfileCount(account), 0);
  const discount = Number(document.querySelector("#personDiscount").value || 0);
  document.querySelector("#personAmount").value = Math.max(0, subtotal - discount).toFixed(2);
}

function normalizeAccountIds(ids, fallbackId = "") {
  if (Array.isArray(ids)) return ids.filter(Boolean);
  if (typeof ids === "string" && ids) return [ids];
  return fallbackId ? [fallbackId] : [];
}

function accountLabel(account) {
  return `${account.service} - ${account.name}`;
}

function accountAssignmentLabel(account, profiles = {}) {
  const selectedProfiles = normalizeProfileSelection(profiles?.[account.id]);
  return selectedProfiles.length ? `${accountLabel(account)} (${selectedProfiles.join(", ")})` : accountLabel(account);
}

function accountListLabel(accounts, profiles = {}) {
  return accounts.map((account) => accountAssignmentLabel(account, profiles)).join(", ");
}

function parseProfileNames(value) {
  return value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function syncAccountProfileControls() {
  els.personAccounts.querySelectorAll("[data-account-option]").forEach((option) => {
    const checkbox = option.querySelector("[data-account-checkbox]");
    const picker = option.querySelector("[data-profile-for]");
    if (picker) picker.hidden = !checkbox.checked;
  });
}

function getProfilePicker(accountId) {
  return Array.from(els.personAccounts.querySelectorAll("[data-profile-for]")).find((picker) => picker.dataset.profileFor === accountId);
}

function getSelectedProfilesForAccount(accountId) {
  const picker = getProfilePicker(accountId);
  if (!picker) return [];
  return Array.from(picker.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
}

function setSelectedProfilesForAccount(accountId, profiles) {
  const selectedProfiles = new Set(normalizeProfileSelection(profiles));
  const picker = getProfilePicker(accountId);
  if (!picker) return;
  picker.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = selectedProfiles.has(input.value);
  });
}

function normalizeProfileSelection(profiles) {
  if (Array.isArray(profiles)) return profiles.filter(Boolean);
  if (typeof profiles === "string" && profiles) return [profiles];
  return [];
}

function getBillableProfileCount(account) {
  const selectedProfiles = getSelectedProfilesForAccount(account.id);
  if (selectedProfiles.length) return selectedProfiles.length;
  return 1;
}

function setPersonMessage(message) {
  els.personFormMessage.textContent = message;
}

function setFormBusy(form, busy) {
  form.querySelectorAll("button, input, select, textarea").forEach((field) => {
    field.disabled = busy;
  });
}

function getErrorMessage(error) {
  return error?.message || "revisa tu conexion y vuelve a intentar.";
}
