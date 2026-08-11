const SUPABASE_URL = "https://zclcywdtyuzjhjilrphs.supabase.co";
const SUPABASE_KEY = "sb_publishable_7a3GuQd3MQqjCmzrqg4ZUQ_vdd7Z-71";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const config = {
  dates: ["2026-09-08","2026-09-09","2026-09-10","2026-09-11","2026-09-12"],
  times: ["10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30"]
};

let selectedDate = config.dates[0];
let selectedTime = null;
let holdToken = localStorage.getItem("kraw_hold_token") || "";
let adminToken = sessionStorage.getItem("kraw_admin_token") || "";
let adminBookings = [];
const $ = s => document.querySelector(s);

const fmtDate = d => new Intl.DateTimeFormat("tr-TR",{weekday:"short",day:"numeric",month:"short"}).format(new Date(d+"T12:00:00"));
const longDate = d => new Intl.DateTimeFormat("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(d+"T12:00:00"));

function friendlyError(error){
  const raw = String(error?.message || error || "İşlem başarısız.");
  const map = {
    SLOT_BOOKED:"Bu saat dolu. Lütfen başka bir saat seçin.",
    SLOT_HELD:"Bu saat şu anda başka bir ziyaretçi tarafından seçildi.",
    HOLD_EXPIRED:"Saat seçiminizin 5 dakikalık süresi doldu. Lütfen yeniden seçin.",
    INVALID_SLOT:"Geçersiz randevu saati.",
    INVALID_NAME:"Lütfen geçerli bir ad soyad girin.",
    INVALID_COMPANY:"Lütfen firma adını girin.",
    INVALID_EMAIL:"Lütfen geçerli bir e-posta adresi girin.",
    INVALID_PHONE:"Lütfen geçerli bir telefon numarası girin.",
    UNAUTHORIZED:"Admin oturumunuz sona erdi. Lütfen tekrar giriş yapın."
  };
  for(const [key,value] of Object.entries(map)) if(raw.includes(key)) return value;
  return raw;
}

async function rpc(name, params={}){
  const {data,error} = await db.rpc(name,params);
  if(error) throw new Error(friendlyError(error));
  return data;
}

function endTime(t){
  let [h,m]=t.split(":").map(Number); m+=30; if(m>=60){h++;m-=60}
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function renderDates(){
  $("#dateTabs").innerHTML = config.dates.map((d,i)=>`
    <button class="date-tab ${d===selectedDate?"active":""}" data-date="${d}">
      <span>${["Salı","Çarşamba","Perşembe","Cuma","Cumartesi"][i]}</span>
      <b>${new Date(d+"T12:00:00").getDate()} Eylül</b>
    </button>`).join("");
  document.querySelectorAll(".date-tab").forEach(b=>b.onclick=async()=>{
    if(selectedTime) await releaseHold();
    selectedDate=b.dataset.date;
    selectedTime=null;
    $("#formCard").classList.add("hidden");
    renderDates();
    await refreshSlots();
  });
}

async function refreshSlots(){
  try{
    const rows = await rpc("kraw_get_slot_status",{p_hold_token:holdToken || null});
    const status = new Map((rows||[]).map(x=>[`${x.day}|${x.slot_time}`,x]));
    $("#slots").innerHTML = config.times.map(t=>{
      const s=status.get(`${selectedDate}|${t}`);
      const busy=s && (s.slot_status==="booked" || (s.slot_status==="held" && !s.mine));
      return `<button class="slot ${s?.mine?"mine":""}" data-time="${t}" ${busy?"disabled":""}>${t}</button>`;
    }).join("");
    document.querySelectorAll(".slot:not(:disabled)").forEach(b=>b.onclick=()=>chooseSlot(b.dataset.time));
  }catch(err){ console.error(err); }
}

async function chooseSlot(time){
  if(selectedTime && selectedTime!==time) await releaseHold();
  try{
    const result = await rpc("kraw_claim_slot",{p_day:selectedDate,p_time:time});
    const hold = Array.isArray(result) ? result[0] : result;
    holdToken = hold.hold_token;
    localStorage.setItem("kraw_hold_token",holdToken);
    selectedTime=time;
    $("#selectedSummary").textContent=`${longDate(selectedDate)} · ${time}–${endTime(time)}`;
    $("#formCard").classList.remove("hidden");
    $("#formCard").scrollIntoView({behavior:"smooth",block:"start"});
    await refreshSlots();
  }catch(err){ alert(friendlyError(err)); await refreshSlots(); }
}

async function releaseHold(){
  if(!selectedDate || !selectedTime || !holdToken) return;
  try{await rpc("kraw_release_slot",{p_day:selectedDate,p_time:selectedTime,p_hold_token:holdToken});}catch{}
  selectedTime=null;
  holdToken="";
  localStorage.removeItem("kraw_hold_token");
}

$("#cancelSelection").onclick=async()=>{
  await releaseHold();
  $("#formCard").classList.add("hidden");
  await refreshSlots();
};

$("#bookingForm").onsubmit=async e=>{
  e.preventDefault();
  if(!selectedTime || !holdToken) return alert("Lütfen önce bir saat seçin.");
  const btn=e.submitter, previous=btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML='Kaydediliyor <span>…</span>';
  const f=Object.fromEntries(new FormData(e.target).entries());
  try{
    const bookingId = await rpc("kraw_create_booking",{
      p_hold_token:holdToken,p_name:f.name,p_company:f.company,p_email:f.email,p_phone:f.phone,p_day:selectedDate,p_time:selectedTime
    });
    localStorage.removeItem("kraw_hold_token");
    holdToken="";
    let emailSent=false;
    try{
      const {data,error}=await db.functions.invoke("send-booking-confirmation",{body:{booking_id:bookingId}});
      emailSent=!error && data?.sent===true;
    }catch{}
    $("#formCard").classList.add("hidden");
    $("#successCard").classList.remove("hidden");
    $("#successText").textContent=`${longDate(selectedDate)}, ${selectedTime}–${endTime(selectedTime)} için görüşmenizi ayırdık.${emailSent?" Randevu bilgileriniz e-posta adresinize gönderildi.":" Rezervasyonunuz sisteme kaydedildi."}`;
    e.target.reset();
    await refreshSlots();
  }catch(err){
    alert(friendlyError(err));
    btn.disabled=false;
    btn.innerHTML=previous;
    await refreshSlots();
  }
};

const adminDialog=$("#adminDialog"), editDialog=$("#editDialog");
$("#adminBtn").onclick=async()=>{adminDialog.showModal();await checkAdmin();};
$("#closeAdmin").onclick=()=>adminDialog.close();
$("#closeEdit").onclick=()=>editDialog.close();

async function checkAdmin(){
  let authenticated=false;
  if(adminToken){
    try{authenticated=await rpc("kraw_admin_session_valid",{p_session_token:adminToken});}catch{}
  }
  if(!authenticated){adminToken="";sessionStorage.removeItem("kraw_admin_token");}
  $("#adminLogin").classList.toggle("hidden",authenticated);
  $("#adminPanel").classList.toggle("hidden",!authenticated);
  if(authenticated) await loadAdmin();
}

$("#loginForm").onsubmit=async e=>{
  e.preventDefault();
  $("#loginError").textContent="";
  const f=Object.fromEntries(new FormData(e.target).entries());
  try{
    const result=await rpc("kraw_admin_login",{p_username:f.username,p_password:f.password});
    const row=Array.isArray(result)?result[0]:result;
    if(!row?.session_token){
      $("#loginError").textContent=row?.error_code==="LOCKED"?"Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.":"Kullanıcı adı veya şifre hatalı.";
      return;
    }
    adminToken=row.session_token;
    sessionStorage.setItem("kraw_admin_token",adminToken);
    e.target.reset();
    await checkAdmin();
  }catch(err){$("#loginError").textContent=friendlyError(err);}
};

$("#logoutBtn").onclick=async()=>{
  try{if(adminToken) await rpc("kraw_admin_logout",{p_session_token:adminToken});}catch{}
  adminToken="";sessionStorage.removeItem("kraw_admin_token");await checkAdmin();
};

async function loadAdmin(){
  try{
    const rows=await rpc("kraw_admin_list_bookings",{p_session_token:adminToken});
    adminBookings=(rows||[]).map(b=>({...b,date:b.day,time:b.slot_time}));
    $("#bookingCount").textContent=adminBookings.length;
    $("#adminList").innerHTML=adminBookings.length?adminBookings.map(b=>`
      <div class="admin-row">
        <div><b>${fmtDate(b.date)}</b></div><div><b>${b.time}</b></div>
        <div class="wide"><b>${esc(b.name)}</b><div class="muted">${esc(b.company)}</div></div>
        <div class="wide">${esc(b.email||"—")}</div><div>${esc(b.phone||"—")}</div>
        <div class="admin-actions"><button data-edit="${b.id}">Düzenle</button><button class="danger" data-del="${b.id}">Sil</button></div>
      </div>`).join(""):`<p class="muted">Henüz randevu yok.</p>`;
    document.querySelectorAll("[data-edit]").forEach(x=>x.onclick=()=>openEdit(adminBookings.find(b=>b.id===x.dataset.edit)));
    document.querySelectorAll("[data-del]").forEach(x=>x.onclick=()=>deleteBooking(x.dataset.del));
  }catch(err){
    if(String(err.message).includes("Admin oturumunuz")){adminToken="";sessionStorage.removeItem("kraw_admin_token");await checkAdmin();}
    else alert(friendlyError(err));
  }
}

function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
function prepSelects(){
  const f=$("#editForm");
  f.date.innerHTML=config.dates.map(d=>`<option value="${d}">${longDate(d)}</option>`).join("");
  f.time.innerHTML=config.times.map(t=>`<option value="${t}">${t}</option>`).join("");
}
function openEdit(b=null){
  prepSelects();
  const f=$("#editForm");f.reset();f.id.value=b?.id||"";
  $("#editTitle").textContent=b?"Randevuyu Düzenle":"Randevu Ekle";
  if(b) for(const k of ["date","time","name","company","email","phone"]) f[k].value=b[k]||"";
  editDialog.showModal();
}
$("#addBooking").onclick=()=>openEdit();
$("#editForm").onsubmit=async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.target).entries()), id=data.id;
  try{
    if(id){
      await rpc("kraw_admin_update_booking",{p_session_token:adminToken,p_id:id,p_name:data.name,p_company:data.company,p_email:data.email,p_phone:data.phone,p_day:data.date,p_time:data.time});
    }else{
      await rpc("kraw_admin_create_booking",{p_session_token:adminToken,p_name:data.name,p_company:data.company,p_email:data.email,p_phone:data.phone,p_day:data.date,p_time:data.time});
    }
    editDialog.close();await loadAdmin();await refreshSlots();
  }catch(err){alert(friendlyError(err));}
};
async function deleteBooking(id){
  if(!confirm("Bu randevuyu silmek istediğinize emin misiniz?")) return;
  try{await rpc("kraw_admin_delete_booking",{p_session_token:adminToken,p_id:id});await loadAdmin();await refreshSlots();}catch(err){alert(friendlyError(err));}
}

function subscribeRealtime(){
  db.channel("kraw-slot-events")
    .on("postgres_changes",{event:"*",schema:"public",table:"slot_events"},()=>refreshSlots())
    .subscribe();
}

async function init(){
  renderDates();
  await refreshSlots();
  subscribeRealtime();
  setInterval(refreshSlots,30000);
}
init().catch(e=>{document.body.innerHTML=`<pre style="padding:30px">${esc(friendlyError(e))}</pre>`;});
