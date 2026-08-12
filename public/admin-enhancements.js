// KRAW admin dashboard enhancements: day filters, occupancy summary, print view and bulk actions.
let adminDayFilter = "all";
const selectedAdminBookings = new Set();

function getAdminFilteredBookings() {
  const term = ($("#adminSearch")?.value || "").trim().toLocaleLowerCase("en-GB");
  return adminBookings.filter(b => {
    const dayMatch = adminDayFilter === "all" || b.date === adminDayFilter;
    const textMatch = !term || [b.name,b.company,b.email,b.phone,b.date,b.time]
      .join(" ").toLocaleLowerCase("en-GB").includes(term);
    return dayMatch && textMatch;
  });
}

function ensureBulkControls() {
  const toolbar = document.querySelector(".admin-toolbar");
  if (toolbar && !$("#deleteSelected")) {
    const btn = document.createElement("button");
    btn.id = "deleteSelected";
    btn.className = "ghost-btn admin-export bulk-delete-btn";
    btn.type = "button";
    btn.disabled = true;
    btn.textContent = "Delete Selected";
    const addBtn = $("#addBooking");
    toolbar.insertBefore(btn, addBtn || null);
    btn.onclick = bulkDeleteBookings;
  }

  const headRow = document.querySelector(".admin-table thead tr");
  if (headRow && !$("#selectAllBookings")) {
    const th = document.createElement("th");
    th.className = "admin-select-col";
    th.innerHTML = '<input id="selectAllBookings" class="admin-check" type="checkbox" aria-label="Select all visible appointments">';
    headRow.insertBefore(th, headRow.firstChild);
    $("#selectAllBookings").onchange = e => {
      const visible = getAdminFilteredBookings();
      if (e.target.checked) visible.forEach(b => selectedAdminBookings.add(String(b.id)));
      else visible.forEach(b => selectedAdminBookings.delete(String(b.id)));
      renderAdminRows();
    };
  }
}

function updateBulkControls(filtered) {
  const btn = $("#deleteSelected");
  const count = selectedAdminBookings.size;
  if (btn) {
    btn.disabled = count === 0;
    btn.textContent = count ? `Delete Selected (${count})` : "Delete Selected";
  }
  const all = $("#selectAllBookings");
  if (all) {
    const ids = filtered.map(b => String(b.id));
    const selectedVisible = ids.filter(id => selectedAdminBookings.has(id)).length;
    all.checked = ids.length > 0 && selectedVisible === ids.length;
    all.indeterminate = selectedVisible > 0 && selectedVisible < ids.length;
  }
}

async function bulkDeleteBookings() {
  const ids = [...selectedAdminBookings];
  if (!ids.length) return;
  if (!confirm(`Are you sure you want to delete ${ids.length} selected appointment${ids.length === 1 ? "" : "s"}?`)) return;

  const btn = $("#deleteSelected");
  if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
  let deleted = 0;
  try {
    for (const id of ids) {
      await rpc("kraw_admin_delete_booking", {p_session_token:adminToken, p_id:id});
      deleted++;
    }
    selectedAdminBookings.clear();
    await loadAdmin();
    await refreshSlots();
  } catch (err) {
    alert(`${deleted} appointment${deleted === 1 ? "" : "s"} deleted before an error occurred. ${friendlyError(err)}`);
    selectedAdminBookings.clear();
    await loadAdmin();
    await refreshSlots();
  }
}

function renderAdminDayFilters() {
  const wrap = $("#adminDayFilters");
  if (!wrap) return;
  wrap.innerHTML = config.dates.map(d => `
    <button class="filter-btn ${adminDayFilter===d?"active":""}" data-admin-day="${d}">${fmtDate(d)}</button>
  `).join("");

  document.querySelectorAll("[data-admin-day]").forEach(btn => {
    btn.onclick = () => {
      adminDayFilter = btn.dataset.adminDay;
      syncAdminFilterButtons();
      renderAdminRows();
    };
  });
}

function syncAdminFilterButtons() {
  const allBtn = $("#filterAll");
  if (allBtn) allBtn.classList.toggle("active", adminDayFilter === "all");
  document.querySelectorAll("[data-admin-day]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.adminDay === adminDayFilter);
  });
}

function renderAdminSummary(filtered) {
  const totalSlots = config.dates.length * config.times.length;
  const capacity = adminDayFilter === "all" ? totalSlots : config.times.length;
  const bookedForScope = adminDayFilter === "all"
    ? adminBookings.length
    : adminBookings.filter(b => b.date === adminDayFilter).length;
  const occupancy = capacity ? Math.round((bookedForScope / capacity) * 100) : 0;

  if ($("#summaryTotal")) $("#summaryTotal").textContent = adminBookings.length;
  if ($("#summaryDay")) $("#summaryDay").textContent = adminDayFilter === "all" ? "All days" : fmtDate(adminDayFilter);
  if ($("#summaryBooked")) $("#summaryBooked").textContent = `${bookedForScope} / ${capacity}`;
  if ($("#summaryOccupancy")) $("#summaryOccupancy").textContent = `${occupancy}%`;
  if ($("#bookingCount")) $("#bookingCount").textContent = filtered.length;
}

window.renderAdminRows = function () {
  ensureBulkControls();
  const filtered = getAdminFilteredBookings();
  renderAdminSummary(filtered);

  const existingIds = new Set(adminBookings.map(b => String(b.id)));
  [...selectedAdminBookings].forEach(id => { if (!existingIds.has(id)) selectedAdminBookings.delete(id); });

  const empty = $("#adminEmpty");
  if (empty) empty.classList.toggle("hidden", filtered.length > 0);
  const list = $("#adminList");
  if (!list) return;

  list.innerHTML = filtered.map(b => `
    <tr class="${selectedAdminBookings.has(String(b.id)) ? "selected-row" : ""}">
      <td class="admin-select-col"><input class="admin-check row-booking-check" type="checkbox" data-select-booking="${b.id}" aria-label="Select ${esc(b.name)}" ${selectedAdminBookings.has(String(b.id)) ? "checked" : ""}></td>
      <td><b>${fmtDate(b.date)}</b></td>
      <td><b>${esc(b.time)}</b></td>
      <td>${esc(b.name)}</td>
      <td>${esc(b.company)}</td>
      <td><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></td>
      <td><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></td>
      <td><div class="admin-actions"><button data-edit="${b.id}">Edit</button><button class="danger" data-del="${b.id}">Delete</button></div></td>
    </tr>`).join("");

  document.querySelectorAll("[data-select-booking]").forEach(x => x.onchange = () => {
    const id = String(x.dataset.selectBooking);
    if (x.checked) selectedAdminBookings.add(id); else selectedAdminBookings.delete(id);
    renderAdminRows();
  });
  document.querySelectorAll("[data-edit]").forEach(x => x.onclick = () => openEdit(adminBookings.find(b => String(b.id) === String(x.dataset.edit))));
  document.querySelectorAll("[data-del]").forEach(x => x.onclick = () => deleteBooking(x.dataset.del));
  updateBulkControls(filtered);
};

const originalLoadAdmin = window.loadAdmin;
window.loadAdmin = async function () {
  await originalLoadAdmin();
  renderAdminDayFilters();
  syncAdminFilterButtons();
  renderAdminRows();
};

const searchInput = $("#adminSearch");
if (searchInput) searchInput.oninput = () => renderAdminRows();

const allButton = $("#filterAll");
if (allButton) allButton.onclick = () => {
  adminDayFilter = "all";
  syncAdminFilterButtons();
  renderAdminRows();
};

const todayButton = $("#filterToday");
if (todayButton) todayButton.onclick = () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
  if (!config.dates.includes(today)) {
    alert("Today is outside the Automechanika appointment dates (8–12 September 2026). Please select a fair day.");
    return;
  }
  adminDayFilter = today;
  syncAdminFilterButtons();
  renderAdminRows();
};

const exportButton = $("#exportCsv");
if (exportButton) exportButton.onclick = () => {
  const rowsToExport = getAdminFilteredBookings();
  if (!rowsToExport.length) return alert("There are no appointments to export in the current view.");
  const csvCell = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const headers = ["Date","Time","Full Name","Company","Email","Phone","Created At"];
  const rows = rowsToExport.map(b => [b.date,b.time,b.name,b.company,b.email,b.phone,b.created_at]);
  const csv = "\uFEFF" + [headers,...rows].map(r => r.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `KRAW_Automechanika_${adminDayFilter === "all" ? "All_Days" : adminDayFilter}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

const printButton = $("#printSchedule");
if (printButton) printButton.onclick = () => {
  if (adminDayFilter === "all") return alert("Please select a fair day before printing the daily schedule.");
  const rows = adminBookings.filter(b => b.date === adminDayFilter).sort((a,b) => a.time.localeCompare(b.time));
  const title = `${longDate(adminDayFilter)} · KRAW Appointment Schedule`;
  const bodyRows = rows.length ? rows.map(b => `
    <tr><td>${esc(b.time)}–${esc(endTime(b.time))}</td><td>${esc(b.name)}</td><td>${esc(b.company)}</td><td>${esc(b.email)}</td><td>${esc(b.phone)}</td></tr>
  `).join("") : `<tr><td colspan="5">No appointments for this day.</td></tr>`;

  const popup = window.open("", "_blank", "width=1000,height=800");
  if (!popup) return alert("Pop-up blocked. Please allow pop-ups to print the schedule.");
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Arial,sans-serif;color:#16384d;padding:28px}h1{font-size:22px;margin:0 0 6px}p{color:#627f91;margin:0 0 24px}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #d9e8f1;padding:10px;text-align:left}th{background:#eef8fd}
    .meta{display:flex;gap:24px;margin:18px 0 24px;font-size:13px}.meta b{font-size:18px;display:block;margin-top:4px}
    @media print{body{padding:0}}
  </style></head><body><h1>${esc(title)}</h1><p>Automechanika Frankfurt 2026 · Frankfurt local time</p>
  <div class="meta"><div>Appointments<b>${rows.length}</b></div><div>Capacity<b>${config.times.length}</b></div><div>Occupancy<b>${Math.round((rows.length/config.times.length)*100)}%</b></div></div>
  <table><thead><tr><th>Time</th><th>Full Name</th><th>Company</th><th>Email</th><th>Phone</th></tr></thead><tbody>${bodyRows}</tbody></table>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
};

// Keep an open admin panel synchronized when slot events arrive from another browser/device.
db.channel("kraw-admin-live-sync").on("postgres_changes", {event:"*",schema:"public",table:"slot_events"}, async () => {
  await refreshSlots();
  if (adminToken && $("#adminDialog")?.open && !$("#adminPanel")?.classList.contains("hidden")) {
    try { await loadAdmin(); } catch {}
  }
}).subscribe();

window.addEventListener("focus", () => refreshSlots());
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSlots(); });

ensureBulkControls();
renderAdminDayFilters();
syncAdminFilterButtons();
