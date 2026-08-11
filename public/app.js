let config, selectedDate, selectedTime, holdToken = localStorage.getItem("kraw_hold_token") || "";
const $ = s => document.querySelector(s);

const fmtDate = d => new Intl.DateTimeFormat("tr-TR",{weekday:"short",day:"numeric",month:"short"}).format(new Date(d+"T12:00:00"));
const longDate = d => new Intl.DateTimeFormat("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(d+"T12:00:00"));

async function api(url, options={}) {
  options.headers = { "Content-Type":"application/json", ...(options.headers||{}) };
  if (holdToken) options.headers["X-Hold-Token"] = holdToken;
  const r = await fetch(url, options);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "İşlem başarısız.");
  return data;
}

async function init(){
  config = await api("/api/config");
  selectedDate = config.dates[0];
  renderDates();
  await refreshSlots();
  setInterval(refreshSlots, 15000);
}
function renderDates(){
  $("#dateTabs").innerHTML = config.dates.map((d,i)=>`
    <button class="date-tab ${d===selectedDate?"active":""}" data-date="${d}">
      <span>${["Salı","Çarşamba","Perşembe","Cuma","Cumartesi"][i]}</span>
      <b>${new Date(d+"T12:00:00").getDate()} Eylül</b>
    </button>`).join("");
  document.querySelectorAll(".date-tab").forEach(b=>b.onclick=async()=>{
    if(selectedTime) await releaseHold();
    selectedDate=b.dataset.date; selectedTime=null; $("#formCard").classList.add("hidden");
    renderDates(); await refreshSlots();
  });
}
async function refreshSlots(){
  const data = await api("/api/slots");
  const booked = new Set(data.bookings.map(x=>`${x.date}|${x.time}`));
  const holds = new Map(data.holds.map(x=>[`${x.date}|${x.time}`,x]));
  $("#slots").innerHTML = config.times.map(t=>{
    const key=`${selectedDate}|${t}`, isBooked=booked.has(key), h=holds.get(key), busy=isBooked || (h && !h.mine);
    return `<button class="slot ${h?.mine?"mine":""}" data-time="${t}" ${busy?"disabled":""}>${t}</button>`;
  }).join("");
  document.querySelectorAll(".slot:not(:disabled)").forEach(b=>b.onclick=()=>chooseSlot(b.dataset.time));
}
async function chooseSlot(time){
  if(selectedTime && selectedTime!==time) await releaseHold();
  try{
    const r=await api("/api/holds",{method:"POST",body:JSON.stringify({date:selectedDate,time})});
    holdToken=r.token; localStorage.setItem("kraw_hold_token",holdToken); selectedTime=time;
    $("#selectedSummary").textContent=`${longDate(selectedDate)} · ${time}–${endTime(time)}`;
    $("#formCard").classList.remove("hidden");
    $("#formCard").scrollIntoView({behavior:"smooth",block:"start"});
    await refreshSlots();
  }catch(e){ alert(e.message); await refreshSlots(); }
}
function endTime(t){
  let [h,m]=t.split(":").map(Number); m+=30;if(m>=60){h++;m-=60}return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
async function releaseHold(){
  if(!selectedDate || !selectedTime || !holdToken) return;
  try{await api("/api/holds",{method:"DELETE",body:JSON.stringify({date:selectedDate,time:selectedTime})})}catch{}
  selectedTime=null; holdToken=""; localStorage.removeItem("kraw_hold_token");
}
$("#cancelSelection").onclick=async()=>{await releaseHold();$("#formCard").classList.add("hidden");await refreshSlots()}
$("#bookingForm").onsubmit=async e=>{
  e.preventDefault();
  const btn=e.submitter;btn.disabled=true;
  const previous = btn.innerHTML;
  btn.innerHTML = 'Kaydediliyor <span>…</span>';
  const f=Object.fromEntries(new FormData(e.target).entries());
  try{
    const result = await api("/api/bookings",{method:"POST",body:JSON.stringify({...f,date:selectedDate,time:selectedTime})});
    localStorage.removeItem("kraw_hold_token"); holdToken="";
    $("#formCard").classList.add("hidden"); $("#successCard").classList.remove("hidden");
    const emailMessage = result.emailSent
      ? "Randevu bilgileriniz e-posta adresinize gönderildi."
      : "Randevu oluşturuldu. E-posta gönderimi yapılamadıysa SMTP ayarları kontrol edilmelidir.";
    $("#successText").textContent=`${longDate(selectedDate)}, ${selectedTime}–${endTime(selectedTime)} için görüşmenizi ayırdık. ${emailMessage}`;
    await refreshSlots();
  }catch(err){
    alert(err.message);
    btn.disabled=false;
    btn.innerHTML = previous;
  }
};

const adminDialog=$("#adminDialog"), editDialog=$("#editDialog");
$("#adminBtn").onclick=async()=>{adminDialog.showModal();await checkAdmin()}
$("#closeAdmin").onclick=()=>adminDialog.close();
$("#closeEdit").onclick=()=>editDialog.close();

async function checkAdmin(){
  const s=await api("/api/admin/session");
  $("#adminLogin").classList.toggle("hidden",s.authenticated);
  $("#adminPanel").classList.toggle("hidden",!s.authenticated);
  if(s.authenticated) await loadAdmin();
}
$("#loginForm").onsubmit=async e=>{
  e.preventDefault(); $("#loginError").textContent="";
  try{
    await api("/api/admin/login",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target).entries()))});
    e.target.reset(); await checkAdmin();
  }catch(err){ $("#loginError").textContent=err.message }
};
$("#logoutBtn").onclick=async()=>{await api("/api/admin/logout",{method:"POST"});await checkAdmin()};

let adminBookings=[];
async function loadAdmin(){
  const d=await api("/api/admin/bookings");
  adminBookings=d.bookings;
  $("#bookingCount").textContent=adminBookings.length;
  $("#adminList").innerHTML=adminBookings.length?adminBookings.map(b=>`
    <div class="admin-row">
      <div><b>${fmtDate(b.date)}</b></div>
      <div><b>${b.time}</b></div>
      <div class="wide"><b>${esc(b.name)}</b><div class="muted">${esc(b.company)}</div></div>
      <div class="wide">${esc(b.email || "—")}</div>
      <div>${esc(b.phone || "—")}</div>
      <div class="admin-actions">
        <button data-edit="${b.id}">Düzenle</button>
        <button class="danger" data-del="${b.id}">Sil</button>
      </div>
    </div>`).join(""):`<p class="muted">Henüz randevu yok.</p>`;
  document.querySelectorAll("[data-edit]").forEach(x=>x.onclick=()=>openEdit(adminBookings.find(b=>b.id===x.dataset.edit)));
  document.querySelectorAll("[data-del]").forEach(x=>x.onclick=()=>deleteBooking(x.dataset.del));
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function prepSelects(){
  const f=$("#editForm");
  f.date.innerHTML=config.dates.map(d=>`<option value="${d}">${longDate(d)}</option>`).join("");
  f.time.innerHTML=config.times.map(t=>`<option value="${t}">${t}</option>`).join("");
}
function openEdit(b=null){
  prepSelects();
  const f=$("#editForm");
  f.reset();
  f.id.value=b?.id||"";
  $("#editTitle").textContent=b?"Randevuyu Düzenle":"Randevu Ekle";
  if(b) for(const k of ["date","time","name","company","email","phone"]) f[k].value=b[k]||"";
  editDialog.showModal();
}
$("#addBooking").onclick=()=>openEdit();
$("#editForm").onsubmit=async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.target).entries()),id=data.id;
  delete data.id;
  try{
    await api(id?`/api/admin/bookings/${id}`:"/api/admin/bookings",{method:id?"PUT":"POST",body:JSON.stringify(data)});
    editDialog.close(); await loadAdmin(); await refreshSlots();
  }catch(err){alert(err.message)}
};
async function deleteBooking(id){
  if(!confirm("Bu randevuyu silmek istediğinize emin misiniz?"))return;
  try{await api(`/api/admin/bookings/${id}`,{method:"DELETE"});await loadAdmin();await refreshSlots()}catch(err){alert(err.message)}
}
init().catch(e=>{document.body.innerHTML=`<pre style="color:white;padding:30px">${esc(e.message)}</pre>`});
