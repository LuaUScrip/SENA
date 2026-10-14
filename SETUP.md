# NOX: cara pasang dari HP

Ada dua tingkat. Mulai dari yang pertama, tambah yang kedua kalau mau.

## A. Tanpa server (paling simpel)

Upload ke repo `LuaUScrip/SENA`: `index.html`, `announcements.json`, `roles.json`, `apple-touch-icon.png`, `og-image.png`,
`libnoxuy.txt`, `StealAnEgg_NOX_FULL.lua`.
Settings -> Pages -> Deploy from a branch -> main -> / (root).

- Kartu game (ikon, banner, jumlah pemain, tombol Play) diambil otomatis dari Roblox.
- Komentar memakai GitHub (utterances): repo harus public dan aplikasi utterances dipasang
  di github.com/apps/utterances. Pengunjung perlu akun GitHub. Role dan tanda verified
  TIDAK bisa di mode ini.
- Announcement: edit `announcements.json` di GitHub.
- Role ke pemain: edit `roles.json` di GitHub (kunci = UserId Roblox).

## B. Dengan server (komentar punya nama, role, tanda verified)

Semua lewat browser HP di dash.cloudflare.com (akun gratis).

1. Workers & Pages -> Create -> Start with Hello World -> nama `nox-api` -> Deploy.
   Lalu Edit code: hapus semua isinya, tempel isi `worker.js`, tekan Deploy.
2. Storage & databases -> D1 SQL database -> Create -> nama `nox-db`.
   Buka database itu -> tab Console -> tempel isi `schema.sql` -> Execute.
   (Kalau menolak banyak perintah sekaligus, jalankan satu `CREATE` per kali.)
3. Kembali ke Worker `nox-api` -> Settings -> Bindings -> Add -> D1 database.
   Variable name: `DB`, database: `nox-db`.
4. Settings -> Variables and secrets -> Add:
   - `ADMIN_TOKEN`  (type Secret)  password panel admin, buat yang panjang
   - `CLIENT_KEY`   (type Secret)  teks acak, dipakai juga di libnoxuy.txt
   - `OWNER_UIDS`   (type Text)    11196979266
   - `ALLOWED_ORIGINS` (type Text) https://luauscrip.github.io
   Lalu Deploy.
5. Salin alamat Worker (mis. `https://nox-api.xxxx.workers.dev`).
6. Edit `index.html` di GitHub: isi `API: "alamat-worker"`.
   Edit `libnoxuy.txt`: di `defaultbackend` isi `Api` (alamat) dan `Key` (sama dengan CLIENT_KEY).
7. Buka `https://luauscrip.github.io/SENA/admin.html`, isi alamat dan ADMIN_TOKEN.
   Dari sana: buat key per rank, kirim announcement, hapus/pin komentar, ban pemain.

## Cara kerja komentar (mode B)

- Siapa pun bisa komentar sebagai tamu (tanpa rank).
- Kalau mengisi key NOX yang valid: tampil rank (VIP, DONATOR, dst.) dan tanda verified. Key tidak
  pernah ditampilkan atau disimpan bersama komentar.
- Nama yang mengandung owner, admin, staff, mod, atau nox hanya boleh dipakai dengan key valid.
- Kamu bisa posting sebagai OWNER/ADMIN/STAFF (ter-verified dan bisa di-pin) dari tab Comments di admin.html.
- Batas: 1 komentar per 20 detik per pengunjung, 500 karakter.

## Catatan
- Paket gratis Cloudflare: 100.000 request Worker per hari.
- Server menyimpan UserId, username, HWID (batas perangkat) dan pesan. Beri tahu pemain di Discord.
