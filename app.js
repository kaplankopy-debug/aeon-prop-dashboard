(() => {
  const KEY_STORAGE = "keel.editKey";
  const API_URL = window.KEEL_API || new URL("api/data", window.location.href.replace(/\/index\.html?$/, "/")).toString();
  const THEME_STORAGE = "keel.theme";
  const TZ = "Europe/London";
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });
  const moneyFull = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
  const pctFmt = new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  let state = null;
  let editMode = false;
  let editingSection = "overview";
  let toastTimer = 0;

  const $ = (id) => document.getElementById(id);
  const qs = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => [...el.querySelectorAll(sel)];

  function todayISO() {
    return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m) return iso;
    const dt = new Date(Date.UTC(y, m - 1, d || 1));
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(dt);
  }

  function formatMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, 1));
    return new Intl.DateTimeFormat("en-GB", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(dt);
  }

  function cls(...parts) {
    return parts.filter(Boolean).join(" ");
  }

  function tone(n) {
    if (n > 0.004) return "up";
    if (n < -0.004) return "down";
    return "";
  }

  function signedMoney(n) {
    const abs = moneyFull.format(Math.abs(n));
    if (n > 0) return "+" + abs;
    if (n < 0) return "−" + abs;
    return moneyFull.format(0);
  }

  function signedPct(n) {
    const p = pctFmt.format(Math.abs(n));
    if (n > 0) return "+" + p;
    if (n < 0) return "−" + p;
    return pctFmt.format(0);
  }

  function uid(prefix) {
    if (crypto.randomUUID) return prefix + "-" + crypto.randomUUID();
    return prefix + "-" + Math.random().toString(36).slice(2, 10);
  }

  function getEditKey() {
    return localStorage.getItem(KEY_STORAGE) || "";
  }

  function setEditKey(value) {
    if (value) localStorage.setItem(KEY_STORAGE, value);
    else localStorage.removeItem(KEY_STORAGE);
  }

  function toast(message, isError) {
    const el = $("toast");
    el.hidden = false;
    el.className = cls("toast", isError && "err");
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }

  function setSync(kind, label) {
    const dot = $("sync-dot");
    dot.className = cls("sync-dot", kind === "ok" ? "" : kind === "warn" ? "warn" : kind === "err" ? "err" : "");
    $("sync-label").textContent = label;
  }

  function accountMath(a) {
    const start = Number(a.startingSize) || 0;
    const bal = Number(a.balance) || 0;
    const pl = bal - start;
    const plPct = start ? pl / start : 0;
    const maxDD = Number(a.maxDrawdownPct) || 0;
    const dailyDD = Number(a.dailyDrawdownPct) || 0;
    const floor = start * (1 - maxDD / 100);
    const toFloor = bal - floor;
    const targetPct = a.profitTargetPct == null || a.profitTargetPct === "" ? null : Number(a.profitTargetPct);
    const target = targetPct == null || Number.isNaN(targetPct) ? null : start * (1 + targetPct / 100);
    const toTarget = target == null ? null : target - bal;
    return { start, bal, pl, plPct, maxDD, dailyDD, floor, toFloor, targetPct, target, toTarget };
  }

  function portfolio(accounts) {
    const list = accounts || [];
    const capital = list.reduce((s, a) => s + (Number(a.startingSize) || 0), 0);
    const balance = list.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    return { capital, balance, pl: balance - capital, count: list.length };
  }

  function receivedPayouts() {
    return (state.payouts || []).filter((p) => p.status === "received");
  }

  function pendingPayouts() {
    return (state.payouts || []).filter((p) => p.status === "pending");
  }

  function sumYear(list, year) {
    return list
      .filter((p) => String(p.date || "").startsWith(String(year)))
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }

  function sumMonth(list, ym) {
    return list
      .filter((p) => String(p.date || "").startsWith(ym))
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }

  function payoutTotals() {
    const received = receivedPayouts();
    const pending = pendingPayouts();
    const allTime = received.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const ytd = sumYear(received, 2026);
    const pendingTotal = pending.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return { allTime, ytd, pendingTotal, count: Number(state.settings?.certificateCount) || 0 };
  }

  async function loadData() {
    setSync("warn", "Loading");
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      if (res.ok) {
        state = await res.json();
        setSync("ok", "Live");
        render();
        return;
      }
      if (res.status === 404 && window.SEED_DATA) {
        state = structuredClone(window.SEED_DATA);
        setSync("warn", "Using starter data");
        render();
        return;
      }
      throw new Error("Could not load data (" + res.status + ")");
    } catch (err) {
      if (window.SEED_DATA) {
        state = structuredClone(window.SEED_DATA);
        setSync("err", "Offline copy");
        toast("Could not reach the server, so a local starter copy is shown.", true);
        render();
        return;
      }
      setSync("err", "Load failed");
      toast(err.message || "Load failed", true);
    }
  }

  async function saveData() {
    const key = getEditKey();
    if (!key) {
      toast("Enter the edit key first.", true);
      return false;
    }
    setSync("warn", "Saving");
    try {
      const res = await fetch(API_URL, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-edit-key": key,
        },
        body: JSON.stringify(state),
      });
      if (res.status === 401) {
        setEditKey("");
        leaveEdit();
        setSync("err", "Key rejected");
        toast("That edit key was not accepted. Try again.", true);
        return false;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed (" + res.status + ")");
      }
      state = await res.json();
      setSync("ok", "Saved " + new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }));
      render();
      toast("Saved.");
      return true;
    } catch (err) {
      setSync("err", "Save failed");
      toast(err.message || "Save failed", true);
      return false;
    }
  }

  function enterEdit() {
    editMode = true;
    document.body.classList.add("edit-on");
    $("edit-btn").textContent = "Done";
    $("edit-btn").classList.remove("secondary");
    $("add-account-btn").hidden = false;
    $("add-payout-btn").hidden = true;
    $("settings-btn").hidden = true;
  }

  function leaveEdit() {
    editMode = false;
    document.body.classList.remove("edit-on");
    $("edit-btn").textContent = "Edit";
    $("edit-btn").classList.add("secondary");
    $("add-account-btn").hidden = true;
    $("add-payout-btn").hidden = true;
    $("settings-btn").hidden = true;
  }

  function askForKey() {
    return new Promise((resolve) => {
      openDialog({
        title: "Enter edit key",
        lead: "This key lets you change balances and payouts. It’s remembered on this device only.",
        body: `
          <label class="wide">Edit key
            <input type="password" id="key-input" autocomplete="current-password" autofocus>
          </label>
        `,
        actions: [
          { label: "Cancel", secondary: true, onClick: () => resolve(null) },
          {
            label: "Continue",
            onClick: () => {
              const value = ($("key-input").value || "").trim();
              if (!value) {
                toast("Please paste the edit key.", true);
                return false;
              }
              setEditKey(value);
              resolve(value);
            },
          },
        ],
        onClose: () => resolve(null),
      });
      setTimeout(() => $("key-input")?.focus(), 30);
    });
  }

  async function ensureKey() {
    if (getEditKey()) return true;
    const value = await askForKey();
    return Boolean(value);
  }

  async function onEditButton() {
    if (editMode) {
      leaveEdit();
      render();
      return;
    }
    if (!(await ensureKey())) return;
    enterEdit();
    render();
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE, theme);
    $("theme-btn").textContent = theme === "dark" ? "Light" : "Dark";
    document.querySelector('meta[name="theme-color"]').setAttribute(
      "content",
      theme === "dark" ? "#111514" : "#f5f5ef"
    );
  }

  function render() {
    if (!state) return;
    renderStats();
    renderAccounts();
    renderPayouts();
    $("add-account-btn").hidden = !editMode;
    $("add-payout-btn").hidden = true;
    $("settings-btn").hidden = true;
  }

  function renderStats() {
    const p = portfolio(state.accounts);
    const t = payoutTotals();
    const plPct = p.capital ? p.pl / p.capital : 0;
    $("stats").innerHTML = [
      statMini("Capital", compactSize(p.capital)),
      statMini("Balance", compactMoney(p.balance)),
      statMini("P/L", signedPct(plPct), tone(p.pl)),
      statMini("2026", compactMoney(t.ytd)),
    ].join("");
  }

  function statMini(label, number, toneName) {
    return `<div class="stat-mini"><span class="k">${escapeHtml(label)}</span><span class="v ${toneName || ""}">${escapeHtml(number)}</span></div>`;
  }

  function compactMoney(n) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }


  function compactSize(n) {
    if (Number.isFinite(n) && n >= 1000 && Math.abs(n % 1000) < 1e-9) {
      return "$" + (n / 1000).toLocaleString("en-US", { maximumFractionDigits: 0 }) + "k";
    }
    return money.format(n);
  }

  function shortFirm(firm) {
    const map = {
      FundingPips: "FPips",
      "Beirman Capital": "Beirman",
      FTMO: "FTMO",
    };
    if (map[firm]) return map[firm];
    const first = String(firm || "Acct").split(/\s+/)[0];
    return first.length > 8 ? first.slice(0, 7) : first;
  }

  function shortLabel(a) {
    const digits = String(a.accountNumber || "").replace(/\D/g, "");
    const tail = digits.slice(-4);
    return shortFirm(a.firm) + (tail ? " …" + tail : "");
  }

  function formatTargetPct(n) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    if (Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v) + "%";
    return v.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  }

  function formatRatioPct(n) {
    return (Math.abs(n) * 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "%";
  }

  function renderAccounts() {
    const grid = $("account-grid");
    const accounts = state.accounts || [];
    if (!accounts.length) {
      grid.innerHTML = `<p class="empty">No accounts yet.</p>`;
      return;
    }
    const p = portfolio(accounts);
    const plPct = p.capital ? p.pl / p.capital : 0;
    const totDD = plPct < 0 ? formatRatioPct(plPct) : "—";
    const totUp = plPct > 0 ? formatRatioPct(plPct) : "—";
    grid.innerHTML = `<div class="account-table" role="table" aria-label="Accounts">
      <div class="account-head" role="row">
        <span>Account</span><span>Tgt</span><span>DD</span><span>Profit</span>
      </div>
      ${accounts.map(accountRow).join("")}
      <div class="account-total" role="row">
        <span class="label">Total</span>
        <span class="num dash">—</span>
        <span class="num ${plPct < 0 ? "down" : "dash"}">${totDD}</span>
        <span class="num ${plPct > 0 ? "up" : "dash"}">${totUp}</span>
      </div>
    </div>`;
    qsa(".account-row", grid).forEach((row) => {
      const id = row.dataset.id;
      row.querySelector(".account-row-main").addEventListener("click", () => toggleAccountRow(row));
      row.querySelector("[data-edit-account]")?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onAccountTap(id);
      });
    });
  }

  function accountRow(a) {
    const m = accountMath(a);
    const sizeNote = a.startingSizeAssumed ? " (assumed)" : "";
    const targetLine = m.target == null
      ? "Not set"
      : `${money.format(m.target)} · ${m.toTarget >= 0 ? signedMoney(m.toTarget) + " to go" : signedMoney(-m.toTarget) + " past"}`;
    const inDD = m.bal < m.start;
    const inProfit = m.bal > m.start;
    const ddText = inDD ? formatRatioPct(m.plPct) : "—";
    const upText = inProfit ? formatRatioPct(m.plPct) : "—";
    return `<div class="account-row" data-id="${escapeHtml(a.id)}" aria-expanded="false">
      <button type="button" class="account-row-main" aria-expanded="false">
        <span class="label">${escapeHtml(shortLabel(a))}</span>
        <span class="num">${escapeHtml(formatTargetPct(m.targetPct))}</span>
        <span class="num ${inDD ? "down" : "dash"}">${ddText}</span>
        <span class="num ${inProfit ? "up" : "dash"}">${upText}</span>
      </button>
      <div class="account-detail">
        <div class="metrics">
          <div class="metric"><div class="k">Firm / label</div><div class="v">${escapeHtml(a.firm)} · ${escapeHtml(a.label || "—")}</div></div>
          <div class="metric"><div class="k">Account</div><div class="v">#${escapeHtml(a.accountNumber || "—")}</div></div>
          <div class="metric"><div class="k">Server</div><div class="v">${escapeHtml(a.server || "—")}</div></div>
          <div class="metric"><div class="k">Status</div><div class="v">${escapeHtml(a.status || "—")}</div></div>
          <div class="metric"><div class="k">Starting size${sizeNote}</div><div class="v">${money.format(m.start)}</div></div>
          <div class="metric"><div class="k">Balance</div><div class="v">${moneyFull.format(m.bal)}</div></div>
          <div class="metric"><div class="k">P/L vs start</div><div class="v ${tone(m.pl)}">${signedMoney(m.pl)} (${signedPct(m.plPct)})</div></div>
          <div class="metric"><div class="k">Max DD ${m.maxDD}%${a.drawdownDefaults ? " · default" : ""}</div><div class="v">Floor ${money.format(m.floor)}</div></div>
          <div class="metric"><div class="k">Room to max-DD floor</div><div class="v ${tone(m.toFloor)}">${signedMoney(m.toFloor)}</div></div>
          <div class="metric"><div class="k">Daily DD limit${a.drawdownDefaults ? " · default" : ""}</div><div class="v">${m.dailyDD}%</div></div>
          <div class="metric"><div class="k">Profit target${a.profitTargetDefault ? " · default" : ""}</div><div class="v">${escapeHtml(targetLine)}</div></div>
          <div class="metric"><div class="k">Updated</div><div class="v">${escapeHtml(formatDate(a.lastUpdated))} · Hedge · USD</div></div>
        </div>
        <div class="account-detail-actions">
          <button type="button" class="button" data-edit-account>Update</button>
        </div>
      </div>
    </div>`;
  }

  function toggleAccountRow(row) {
    const open = row.getAttribute("aria-expanded") === "true";
    qsa(".account-row", $("account-grid")).forEach((r) => {
      r.setAttribute("aria-expanded", "false");
      r.querySelector(".account-row-main")?.setAttribute("aria-expanded", "false");
    });
    if (!open) {
      row.setAttribute("aria-expanded", "true");
      row.querySelector(".account-row-main")?.setAttribute("aria-expanded", "true");
    }
  }

  async function onAccountTap(id) {
    if (!(await ensureKey())) return;
    if (!editMode) enterEdit();
    const account = state.accounts.find((a) => a.id === id);
    if (!account) return;
    openAccountEditor(account);
  }

  function openAccountEditor(account) {
    const isNew = !account.id;
    const draft = { ...account };
    openDialog({
      title: isNew ? "Add account" : "Update account",
      lead: isNew ? "Add a prop account. Starting size and drawdown limits can be changed later." : "Change the balance or any other figure, then save.",
      body: `
        <div class="form-grid">
          <label>Firm<input id="f-firm" value="${escapeAttr(draft.firm || "")}"></label>
          <label>Label<input id="f-label" value="${escapeAttr(draft.label || "")}"></label>
          <label>Account number<input id="f-number" value="${escapeAttr(draft.accountNumber || "")}"></label>
          <label>Server<input id="f-server" value="${escapeAttr(draft.server || "")}"></label>
          <label class="wide">Balance (USD)<input id="f-balance" type="number" step="0.01" inputmode="decimal" value="${draft.balance ?? ""}"></label>
          <label>Starting size (USD)${draft.startingSizeAssumed ? ' <span class="hint">assumed — change if you know the real size</span>' : ""}
            <input id="f-start" type="number" step="0.01" inputmode="decimal" value="${draft.startingSize ?? ""}">
          </label>
          <label>Status
            <select id="f-status">
              <option value="Funded"${draft.status === "Funded" ? " selected" : ""}>Funded</option>
              <option value="Challenge"${draft.status === "Challenge" ? " selected" : ""}>Challenge</option>
            </select>
          </label>
          <label>Max drawdown %${draft.drawdownDefaults ? ' <span class="hint">editable default (10%)</span>' : ""}
            <input id="f-maxdd" type="number" step="0.1" inputmode="decimal" value="${draft.maxDrawdownPct ?? 10}">
          </label>
          <label>Daily drawdown %${draft.drawdownDefaults ? ' <span class="hint">editable default (5%)</span>' : ""}
            <input id="f-dailydd" type="number" step="0.1" inputmode="decimal" value="${draft.dailyDrawdownPct ?? 5}">
          </label>
          <label>Profit target %${draft.profitTargetDefault ? ' <span class="hint">editable default (10%)</span>' : ""}
            <input id="f-target" type="number" step="0.1" inputmode="decimal" value="${draft.profitTargetPct ?? ""}" placeholder="Optional">
          </label>
          <label>Last updated
            <input id="f-updated" type="date" value="${escapeAttr(draft.lastUpdated || todayISO())}">
          </label>
        </div>
      `,
      actions: [
        ...(isNew || !editMode ? [] : [{
          label: "Delete",
          danger: true,
          onClick: async () => {
            if (!confirm("Delete this account?")) return false;
            state.accounts = state.accounts.filter((a) => a.id !== account.id);
            const ok = await saveData();
            return ok;
          },
        }]),
        { label: "Cancel", secondary: true },
        {
          label: "Save",
          onClick: async () => {
            const balance = Number($("f-balance").value);
            const startingSize = Number($("f-start").value);
            if (!Number.isFinite(balance) || !Number.isFinite(startingSize)) {
              toast("Balance and starting size need to be numbers.", true);
              return false;
            }
            const next = {
              ...draft,
              id: account.id || uid("acc"),
              firm: $("f-firm").value.trim() || "Unknown",
              label: $("f-label").value.trim(),
              accountNumber: $("f-number").value.trim(),
              server: $("f-server").value.trim(),
              balance,
              startingSize,
              startingSizeAssumed: draft.startingSizeAssumed && startingSize === Number(draft.startingSize),
              status: $("f-status").value,
              maxDrawdownPct: Number($("f-maxdd").value),
              dailyDrawdownPct: Number($("f-dailydd").value),
              profitTargetPct: $("f-target").value === "" ? null : Number($("f-target").value),
              profitTargetDefault: draft.profitTargetDefault && String($("f-target").value) === String(draft.profitTargetPct ?? ""),
              drawdownDefaults:
                draft.drawdownDefaults &&
                Number($("f-maxdd").value) === Number(draft.maxDrawdownPct) &&
                Number($("f-dailydd").value) === Number(draft.dailyDrawdownPct),
              lastUpdated: $("f-updated").value || todayISO(),
              currency: "USD",
              mode: "Hedge",
            };
            if (Number(draft.balance) !== balance) next.lastUpdated = todayISO();
            if (isNew) state.accounts.push(next);
            else {
              const i = state.accounts.findIndex((a) => a.id === account.id);
              state.accounts[i] = next;
            }
            return saveData();
          },
        },
      ],
    });
    setTimeout(() => {
      const bal = $("f-balance");
      if (bal) {
        bal.focus();
        bal.select();
      }
    }, 30);
  }

  function renderPayouts() {
    const t = payoutTotals();
    const goal = Number(state.settings?.monthlyGoal) || 10000;
    const yearGoal = goal * 12;
    $("payout-kpis").innerHTML = [
      kpi("2026 YTD received", money.format(t.ytd)),
      kpi("All-time received", money.format(t.allTime)),
      kpi("Certificates", String(t.count)),
      kpi("Pending", money.format(t.pendingTotal)),
    ].join("");

    const months = ["2026-09", "2026-10", "2026-11", "2026-12"];
    const received = receivedPayouts();
    const pending = pendingPayouts();
    const monthBars = months.map((ym) => {
      const rec = sumMonth(received, ym);
      const pend = sumMonth(pending, ym);
      return barRow(formatMonth(ym), rec, goal, pend);
    }).join("");
    const yearBar = barRow("2026 received vs $10k × 12", t.ytd, yearGoal, 0);
    $("bars").innerHTML = monthBars + yearBar;

    const log = $("payout-log");
    const rows = [...(state.payouts || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!rows.length) {
      log.innerHTML = `<p class="empty">No payouts yet.</p>`;
      return;
    }
    log.innerHTML = rows.map((p) => {
      const initials = (p.firm || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      return `<div class="activity">
        <div class="activity-icon ${p.status === "pending" ? "pending" : ""}">${escapeHtml(initials)}</div>
        <div class="activity-body">
          <strong>${escapeHtml(p.firm || "Unknown")}</strong>
          <span>${escapeHtml(formatDate(p.date))}${p.note ? " · " + escapeHtml(p.note) : ""}</span>
        </div>
        <div class="activity-value">
          <strong>${moneyFull.format(Number(p.amount) || 0)}</strong>
          <span>${p.status === "pending" ? "Pending" : "Received"}</span>
        </div>
        ${editMode ? `<div class="activity-actions">
          <button type="button" class="text-button" data-edit-payout="${escapeAttr(p.id)}">Edit</button>
          <button type="button" class="text-button" data-del-payout="${escapeAttr(p.id)}">Delete</button>
        </div>` : ""}
      </div>`;
    }).join("");
    qsa("[data-edit-payout]", log).forEach((btn) => btn.addEventListener("click", () => openPayoutEditor(btn.dataset.editPayout)));
    qsa("[data-del-payout]", log).forEach((btn) => btn.addEventListener("click", () => deletePayout(btn.dataset.delPayout)));
  }

  function kpi(k, v) {
    return `<div class="kpi"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`;
  }

  function barRow(label, received, goal, pending) {
    const recPct = Math.min(100, goal ? (received / goal) * 100 : 0);
    const pendPct = Math.min(100 - recPct, goal ? (pending / goal) * 100 : 0);
    const over = received >= goal && goal > 0;
    const note = pending
      ? `${money.format(received)} received · ${money.format(pending)} pending · goal ${money.format(goal)}`
      : `${money.format(received)} of ${money.format(goal)} (${Math.round(recPct)}%)`;
    return `<div class="bar-row">
      <div class="bar-head"><strong>${escapeHtml(label)}</strong><span>${over ? "Goal met" : money.format(Math.max(0, goal - received)) + " to go"}</span></div>
      <div class="track">
        <div class="fill ${over ? "over" : ""}" style="width:${recPct}%"></div>
        <div class="fill pending" style="left:${recPct}%;width:${pendPct}%"></div>
      </div>
      <div class="bar-note">${escapeHtml(note)}</div>
    </div>`;
  }

  function openPayoutEditor(id) {
    const existing = id ? state.payouts.find((p) => p.id === id) : null;
    const draft = existing || { date: todayISO(), firm: "", amount: "", status: "received", note: "" };
    openDialog({
      title: existing ? "Edit payout" : "Add payout",
      lead: "Pending amounts appear in the log and on the month bar, but they are not added to received totals.",
      body: `
        <div class="form-grid">
          <label>Date<input id="p-date" type="date" value="${escapeAttr(draft.date || "")}"></label>
          <label>Firm<input id="p-firm" value="${escapeAttr(draft.firm || "")}"></label>
          <label>Amount (USD)<input id="p-amount" type="number" step="0.01" inputmode="decimal" value="${draft.amount ?? ""}"></label>
          <label>Status
            <select id="p-status">
              <option value="received"${draft.status !== "pending" ? " selected" : ""}>Received</option>
              <option value="pending"${draft.status === "pending" ? " selected" : ""}>Pending</option>
            </select>
          </label>
          <label class="wide">Note<input id="p-note" value="${escapeAttr(draft.note || "")}"></label>
        </div>
      `,
      actions: [
        { label: "Cancel", secondary: true },
        {
          label: "Save",
          onClick: async () => {
            const amount = Number($("p-amount").value);
            if (!Number.isFinite(amount)) {
              toast("Enter a payout amount.", true);
              return false;
            }
            const next = {
              id: draft.id || uid("pay"),
              date: $("p-date").value || todayISO(),
              firm: $("p-firm").value.trim() || "Unknown",
              amount,
              status: $("p-status").value,
              note: $("p-note").value.trim(),
            };
            if (existing) {
              const i = state.payouts.findIndex((p) => p.id === existing.id);
              state.payouts[i] = next;
            } else {
              state.payouts.push(next);
            }
            return saveData();
          },
        },
      ],
    });
  }

  async function deletePayout(id) {
    if (!confirm("Delete this payout entry?")) return;
    state.payouts = state.payouts.filter((p) => p.id !== id);
    await saveData();
  }

  function openSettings() {
    const s = state.settings || {};
    openDialog({
      title: "Totals & certificates",
      lead: "The certificate count is editable. Received totals are the sum of received log entries, including the two summary baselines.",
      body: `
        <div class="form-grid">
          <label>Monthly payout goal (USD)
            <input id="s-goal" type="number" step="1" value="${s.monthlyGoal ?? 10000}">
          </label>
          <label>Certificate count
            <input id="s-certs" type="number" step="1" value="${s.certificateCount ?? 38}">
          </label>
        </div>
        <p class="lead" style="margin-top:16px">Export or import a JSON backup if you ever want a local copy.</p>
        <div class="dialog-actions" style="margin-top:8px;justify-content:flex-start">
          <button type="button" class="button secondary" id="s-export">Download JSON</button>
          <label class="button secondary" style="margin:0">Import JSON
            <input type="file" id="s-import" accept="application/json" class="sr-only">
          </label>
        </div>
      `,
      actions: [
        { label: "Cancel", secondary: true },
        {
          label: "Save",
          onClick: async () => {
            state.settings = {
              ...s,
              monthlyGoal: Number($("s-goal").value) || 0,
              certificateCount: Number($("s-certs").value) || 0,
            };
            return saveData();
          },
        },
      ],
    });
    $("s-export")?.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "keel-prop-data.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $("s-import")?.addEventListener("change", async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.payouts)) {
          throw new Error("That file doesn’t look like a Keel backup.");
        }
        state = parsed;
        closeDialog();
        await saveData();
      } catch (err) {
        toast(err.message || "Import failed", true);
      }
    });
  }

  let dialogClose = null;

  function openDialog({ title, lead, body, actions, onClose }) {
    closeDialog();
    const root = $("modal-root");
    root.innerHTML = `
      <div class="overlay" data-close="1"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">${escapeHtml(title)}</h2>
        ${lead ? `<p class="lead">${escapeHtml(lead)}</p>` : ""}
        ${body}
        <div class="dialog-actions" id="dlg-actions"></div>
      </div>`;
    const box = qs(".dialog", root);
    const act = $("dlg-actions");
    actions.forEach((action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = cls("button", action.secondary && "secondary", action.danger && "danger");
      btn.textContent = action.label;
      btn.addEventListener("click", async () => {
        if (!action.onClick) {
          closeDialog();
          return;
        }
        const result = await action.onClick();
        if (result !== false) closeDialog();
      });
      act.appendChild(btn);
    });
    qs("[data-close]", root).addEventListener("click", () => closeDialog());
    const onKey = (e) => {
      if (e.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", onKey);
    dialogClose = () => {
      document.removeEventListener("keydown", onKey);
      onClose?.();
    };
    const first = box.querySelector("input, select, textarea, button");
    first?.focus();
  }

  function closeDialog() {
    if (dialogClose) {
      const fn = dialogClose;
      dialogClose = null;
      fn();
    }
    $("modal-root").innerHTML = "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function go(section) {
    editingSection = section;
    qsa(".sidebar nav button").forEach((btn) => {
      btn.toggleAttribute("aria-current", btn.dataset.go === section);
      if (btn.dataset.go === section) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    const el = $(section);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bind() {
    qsa(".sidebar nav button").forEach((btn) => {
      btn.addEventListener("click", () => go(btn.dataset.go));
    });
    $("edit-btn").addEventListener("click", onEditButton);
    $("theme-btn").addEventListener("click", () => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    $("add-account-btn").addEventListener("click", () => openAccountEditor({
      status: "Funded",
      startingSize: 100000,
      startingSizeAssumed: true,
      balance: 100000,
      maxDrawdownPct: 10,
      dailyDrawdownPct: 5,
      drawdownDefaults: true,
      profitTargetPct: 10,
      profitTargetDefault: true,
      lastUpdated: todayISO(),
    }));
    $("add-payout-btn").addEventListener("click", () => openPayoutEditor(null));
    $("settings-btn").addEventListener("click", openSettings);
  }

  const savedTheme = localStorage.getItem(THEME_STORAGE) || "dark";
  setTheme(savedTheme);
  bind();
  if (getEditKey()) {
    // Key is stored, but stay in view mode until they choose Edit.
  }
  loadData();
})();
