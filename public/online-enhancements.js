// KRAW production enhancements: secure email handoff + admin table/search/CSV.

function krawRenderAdminTable(query = "") {
  const q = String(query || "").trim().toLocaleLowerCase("tr-TR");
  const filtered = adminBookings.filter(b => {
    if (!q) return true;
    return [b.date, b.time, b.name, b.company, b.email, b.phone]
      .some(v => String(v || "").toLocaleLowerCase("tr-TR").includes(q));
  });

  const tbody = $("#adminList");
  const empty = $("#adminEmpty");
  if (!tbody || !empty) return;

  empty.classList.toggle("hidden", filtered.length > 0);
  tbody.innerHTML = filtered.map(b => `
    <tr>
      <td><b>${esc(fmtDate(b.date))}</b></td>
      <td><b>${esc(b.time)}</b></td>
      <td>${esc(b.name)}</td>
      <td>${esc(b.company)}</td>
      <td><a href="mailto:${esc(b.email || "")}">${esc(b.email || "—")}</a></td>
      <td><a href="tel:${esc(b.phone || "")}">${esc(b.phone || "—")}</a></td>
      <td>
        <div class="admin-actions">
          <button data-edit="${b.id}">Düzenle</button>
          <button class="danger" data-del="${b.id}">Sil</button>
        </div>
      </td>
    </tr>`).join("");

  document.querySelectorAll("[data-edit]").forEach(x => {
    x.onclick = () => openEdit(adminBookings.find(b => b.id === x.dataset.edit));
  });
  document.querySelectorAll("[data-del]").forEach(x => {
    x.onclick = () => deleteBooking(x.dataset.del);
  });
}

loadAdmin = async function () {
  try {
    const rows = await rpc("kraw_admin_list_bookings", { p_session_token: adminToken });
    adminBookings = (rows || []).map(b => ({ ...b, date: b.day, time: b.slot_time }));
    $("#bookingCount").textContent = adminBookings.length;
    krawRenderAdminTable($("#adminSearch")?.value || "");
  } catch (err) {
    if (String(err.message).includes("Admin oturumunuz")) {
      adminToken = "";
      sessionStorage.removeItem("kraw_admin_token");
      await checkAdmin();
    } else {
      alert(friendlyError(err));
    }
  }
};

const adminSearchInput = $("#adminSearch");
if (adminSearchInput) {
  adminSearchInput.addEventListener("input", e => krawRenderAdminTable(e.target.value));
}

const exportCsvButton = $("#exportCsv");
if (exportCsvButton) {
  exportCsvButton.addEventListener("click", () => {
    if (!adminBookings.length) return alert("Dışa aktarılacak randevu yok.");

    const csvCell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Tarih", "Saat", "Ad Soyad", "Firma", "E-posta", "Telefon"],
      ...adminBookings.map(b => [b.date, b.time, b.name, b.company, b.email, b.phone])
    ];
    const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `KRAW_Automechanika_2026_Randevular_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

const bookingForm = $("#bookingForm");
if (bookingForm) {
  bookingForm.onsubmit = async e => {
    e.preventDefault();
    if (!selectedTime || !holdToken) return alert("Lütfen önce bir saat seçin.");

    const btn = e.submitter;
    const previous = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Kaydediliyor <span>…</span>';
    const f = Object.fromEntries(new FormData(e.target).entries());

    try {
      const result = await rpc("kraw_create_booking", {
        p_hold_token: holdToken,
        p_name: f.name,
        p_company: f.company,
        p_email: f.email,
        p_phone: f.phone,
        p_day: selectedDate,
        p_time: selectedTime
      });

      const created = Array.isArray(result) ? result[0] : result;
      if (!created?.booking_id || !created?.email_token) throw new Error("Rezervasyon oluşturuldu ancak e-posta doğrulama bilgisi alınamadı.");

      localStorage.removeItem("kraw_hold_token");
      holdToken = "";

      let emailSent = false;
      try {
        const { data, error } = await db.functions.invoke("send-booking-confirmation", {
          body: { booking_id: created.booking_id, email_token: created.email_token }
        });
        emailSent = !error && data?.sent === true;
      } catch (mailError) {
        console.warn("Confirmation email could not be sent", mailError);
      }

      $("#formCard").classList.add("hidden");
      $("#successCard").classList.remove("hidden");
      $("#successText").textContent = `${longDate(selectedDate)}, ${selectedTime}–${endTime(selectedTime)} için görüşmenizi ayırdık.${emailSent ? " Randevu bilgileriniz e-posta adresinize gönderildi." : " Rezervasyonunuz sisteme kaydedildi; e-posta servisi henüz yapılandırılmamış olabilir."}`;
      e.target.reset();
      await refreshSlots();
    } catch (err) {
      alert(friendlyError(err));
      btn.disabled = false;
      btn.innerHTML = previous;
      await refreshSlots();
    }
  };
}
