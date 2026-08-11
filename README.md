# KRAW – Automechanika Frankfurt 2026 Randevu Sistemi

Karaca Otomotiv Guvenlik / KRAW icin Automechanika Frankfurt 2026 online randevu uygulamasi.

## Mevcut ozellikler

- 8-12 Eylul 2026 tarihleri
- 10:00-18:00 arasi 30 dakikalik randevu slotlari
- Dolu saatlerin otomatik kapanmasi
- Ad Soyad, E-posta, Telefon ve Firma bilgisi alma
- Admin panelinde randevu goruntuleme, ekleme, duzenleme ve silme
- SMTP tanimlandiginda rezervasyon onay e-postasi
- Mobil uyumlu mavi-beyaz KRAW / Automechanika arayuzu

## Lokal calistirma

Node.js 18+ gerekir.

```bash
npm install
cp .env.example .env
npm start
```

Tarayici: `http://localhost:3000`

## Guvenlik

Admin kullanici adi ve sifresi kaynak koda yazilmaz. `.env` icinde tanimlanir:

```env
ADMIN_USER=admin
ADMIN_PASS=guclu-bir-sifre
```

`.env` dosyasi GitHub'a yuklenmez.

## E-posta

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mail@example.com
SMTP_PASS=mail-password
SMTP_FROM=mail@example.com
```

## Online mimari

Siradaki adimda yerel JSON veri deposu kaldirilip Supabase'e gecilecektir:

- Supabase Postgres: rezervasyonlar
- Supabase Realtime: dolu / bos slot senkronizasyonu
- Supabase Auth veya guvenli server-side admin oturumu
- E-posta servisi: rezervasyon onayi
- GitHub: kaynak kod ve surum kontrolu
- Uygun bir hosting servisi: canli web uygulamasi
