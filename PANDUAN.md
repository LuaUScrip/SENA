# Panduan NOX (library, script, website)

## 1. Jawaban singkat

**Apakah semuanya pasti berfungsi tanpa bug?** Saya tidak bisa menjamin itu, dan tidak jujur kalau saya bilang bisa.
Yang sudah saya uji dan hasilnya:

| Bagian | Sudah diuji | Belum bisa saya uji |
|---|---|---|
| Server (worker.js) | 63 skenario otomatis lolos (key, HWID, chat, announcement, komentar, ban, owner) | Berjalan di Cloudflare asli |
| Website (index.html, admin.html, keygen.html) | Dibuka di browser: kartu game, komentar, role/verified, admin, ukuran layar HP, tanpa error JavaScript | Memuat dari GitHub Pages asli, widget utterances |
| Library dan script (Lua) | Struktur blok kode seimbang, ruang lingkup variabel diperiksa, algoritma hash key dicocokkan dengan hasil Python | **Dijalankan di Roblox/executor**: tidak ada Lua di tempat saya bekerja |

Jadi satu-satunya cara memastikan library dan script bebas error adalah mencobanya di game.
Daftar tes cepat ada di bagian 7. Kalau ada error, kirim screenshot-nya (nomor barisnya penting).

**Apakah script dan loader disimpan di web biar aman?** Tidak bisa dibuat rahasia. Lihat bagian 5.

**Apakah bisa seperti web Sena?** Strukturnya sama: halaman utama, tombol salin loader, daftar rank, cara dapat key,
announcement, komentar. Yang tidak ada: pembayaran otomatis (QRIS/VA), login akun, dan dashboard pengguna.

## 2. Daftar file dan fungsinya

| File | Fungsi | Dipasang di |
|---|---|---|
| `libnoxuy.txt` | Library UI (jendela, tab, rank, key, chat, announcement) | repo GitHub |
| `StealAnEgg_NOX_FULL.lua` | Script Steal An Egg, memuat library di atas | repo GitHub |
| `index.html` | Website: kartu game, rank, key, announcement, komentar | repo GitHub |
| `roles.json` | Daftar pemain yang diberi role (mode tanpa server) | repo GitHub |
| `announcements.json` | Isi berita website dan popup di dalam game (tanpa server) | repo GitHub |
| `admin.html` | Panel admin (butuh server) | repo GitHub |
| `keygen.html` | Pembuat key untuk mode offline | repo GitHub (atau dibuka lokal saja) |
| `apple-touch-icon.png`, `og-image.png` | Dipakai langsung website (ikon layar utama HP dan gambar preview link) | repo GitHub |
| `logo.png`, `favicon.png`, `verified.png`, `icon-play.png`, `icon-key.png`, `icon-copy.png`, `icon-chat.png`, `icon-megaphone.png` | Salinan PNG ikon untuk dipakai di tempat lain (Discord, Roblox). Website sendiri memakai ikon yang tertanam di `index.html` | opsional |
| `worker.js`, `schema.sql` | Server API (opsional) | dashboard Cloudflare |

Semua file web diletakkan di folder paling atas repo, sejajar dengan library dan script.

## 3. Cara kerjanya

**Loader.** Pemain menempel satu baris `loadstring(game:HttpGet("...StealAnEgg_NOX_FULL.lua"))()` di executor.
Script itu memuat `libnoxuy.txt` dari GitHub, membuat jendela NOX, lalu menjalankan fitur-fiturnya.

**Rank.** Ada FREE, VIP, DONATOR, PARTNER, CONTENT CREATOR, ADMIN, NOX WIFE, OWNER (dan TRIAL untuk key percobaan).
Rank tampil di pojok kanan bawah jendela, di kartu Donate, dan di chat. Akun `AntiGodAlt` (UserId 11196979266)
otomatis OWNER tanpa key. Semua rank selain FREE membuka fitur yang ditandai khusus donator.

**Key, mode offline (tanpa server).** Library hanya menyimpan hash dari tiap key di tabel `Chloex.KeyTiers`.
Pemain memasukkan key di tab Donate; library menghitung hash-nya dan mencocokkan.
Key dibuat dengan `keygen.html`.

**Key, mode server.** Kalau alamat server diisi, key dicek ke server: ada batas perangkat (HWID), tanggal kedaluwarsa,
cabut key, dan reset perangkat. Key dibuat dari `admin.html`.

**Announcement.** Mode offline: library membaca `announcements.json` dari GitHub tiap 2 menit dan memunculkan entri baru
sebagai popup (entri dengan `id` lebih besar dari yang pernah dilihat pemain). Mode server: dikirim dari `admin.html`
dan sampai dalam beberapa detik.

**Kartu game.** Tampilannya mengikuti kartu rscripts: banner game dengan chip jumlah kunjungan, pemain aktif, dan waktu update terakhir; logo dan nama game di atas banner; di bawahnya baris NOX (dengan tanda verified), judul, serta tombol Play dan Get script. Semua data (ikon, banner, angka, link Play) dibaca dari Roblox berdasarkan ID game.

**Komentar.** Mode offline: GitHub (utterances). Mode server: komentar punya nama, rank, dan tanda verified.
Verified artinya komentar dikirim dengan key yang valid. Key tidak disimpan atau ditampilkan.

**Role langsung ke pemain (tanpa key).** Ada dua cara, hasilnya sama: pemain tampil dengan role itu dan fitur donator terbuka.
- *Dari GitHub (tanpa server):* edit `roles.json`. Kuncinya UserId Roblox, isinya nama role, atau `{ "role": "VIP", "name": "Kenji", "until": "2026-12-31" }`
  (`until` boleh dihapus kalau tanpa batas waktu). Library membaca file ini tiap 5 menit. Hapus barisnya untuk mencabut role.
- *Dari panel admin (dengan server):* tab **Roles** atau tombol **Give role** di tab **Live players**. Berlaku dalam beberapa detik.
  Tombol **Copy roles.json** di tab Roles menyalin daftar yang sama dalam format GitHub.
Urutan prioritas: akun OWNER, lalu role langsung, lalu key.

**Live players (dengan server).** Tab **Live players** di `admin.html` menampilkan pemain yang sedang online: nama tampilan, nama Roblox, UserId
(klik untuk membuka profil Roblox), rank, game, dan kapan terakhir terlihat. Diperbarui tiap 10 detik. Dari sini kamu bisa memberi role atau ban.
Nama dan UserId hanya terlihat di panel admin. Website publik hanya menampilkan jumlah pemain online, karena menampilkan nama pemain script
secara terbuka bisa membuat mereka mudah dilaporkan.

**Panel admin lainnya.** Licenses (buat, cabut, reset perangkat, tambah hari, salin key, cari), Announce, Comments, Game chat (jeda,
kata terlarang), Bans, dan **Activity** (catatan semua aksi admin selama 90 hari; key hanya dicatat 6 karakter terakhir).

## 4. Cara mengganti

**Link Discord, rscripts, loader.** Buka `index.html` di GitHub (ikon pensil), ubah blok `EDIT HERE` di bagian bawah file.

**Tambah game.** Di blok yang sama, tambahkan baris di `GAMES`:
`{ url: "https://www.roblox.com/games/ID/Nama", note: "Apa yang NOX lakukan di sini." }`.

**Announcement.** Edit `announcements.json`: tambahkan blok baru dengan `id` yang lebih besar dari sebelumnya.
Ubah `"show"` jadi `false` untuk menyembunyikan.

**Key baru (mode offline).**
1. Buka `keygen.html`, pilih rank dan jumlah, tekan *Make keys*.
2. Catat key-nya. Salin baris di kotak "Lines to paste".
3. Di `libnoxuy.txt` cari `Chloex.KeyTiers = {` dan tempel baris itu di dalamnya. Simpan (commit).
4. Untuk mencabut key, hapus barisnya.
Key yang saya berikan sebelumnya sudah ada di tabel itu (7 baris).

**Warna rank.** `libnoxuy.txt`, tabel `Chloex.TierColors` (nilai RGB). Di website: tabel rank di `index.html` (kode warna `--c:#...`) dan
objek `COLORS` di bagian script.

**Akun owner.** `libnoxuy.txt`, fungsi `isowner` (cari `antigodalt`): ganti username dan UserId. Kalau pakai server, ubah juga
`OWNER_UIDS` di pengaturan Worker.

**Background jendela.** `StealAnEgg_NOX_FULL.lua`, cari `local background =`. Ganti dengan link gambar atau ID gambar.
Makin kecil `RowTransparency` makin pekat barisnya; makin besar `BackgroundDim` makin gelap gambarnya.

**Logo/ikon dalam game.** Ikon di jendela memakai asset Roblox `89777034528724`. Untuk mengganti: unggah PNG ke Roblox
(Creator Hub, jenis Decal/Image), ambil ID gambarnya, lalu ganti semua `89777034528724` di `libnoxuy.txt` dan script.

**Logo/ikon website.** Semua ikon ada dalam satu blok `ICONS` di bagian atas `index.html` (di dalam `EDIT HERE`): logo, tanda verified,
ikon mata dan petir di kartu game, serta lima ikon baru (play, key, copy, chat, megaphone). Setiap ikon adalah kode SVG. Ganti dengan SVG-mu sendiri
atau (untuk logo) link gambar. Ikon ikut tampil walau tidak ada file gambar apa pun yang di-upload. Gambar preview link (`og-image.png`, 1200x630)
dan ikon layar utama (`apple-touch-icon.png`) tetap berupa file: ganti filenya dengan nama yang sama.

**Warna dan font website.** Di `index.html`, bagian atas `<style>`: variabel `--bg`, `--text`, `--accent` dst.

## 5. Soal "script disimpan di web biar aman"

Script yang dijalankan di executor selalu bisa dibaca pemakainya, di mana pun disimpan. Yang bisa kamu pilih:

- **Sekarang (GitHub public):** siapa pun bisa membuka link raw-nya dan membaca kodenya. Ini sama dengan cara situs seperti Sena
  menyajikan loader. Repo private tidak bisa dipakai, karena executor tidak bisa login ke GitHub.
- **Obfuscator** (layanan pihak ketiga) membuat kode sulit dibaca, tapi bukan rahasia mutlak, dan bisa mengubah perilaku script.
  Saya tidak menjalankannya di sini; kalau kamu memakainya, uji ulang semua fitur.
- **Script hanya untuk pemegang key** (Worker mengirim script hanya kalau key valid) bisa dibuat, tapi script tetap dapat
  disalin oleh orang yang sudah punya key. Kalau mau, ini bisa saya buatkan sebagai tahap berikutnya.

Yang benar-benar menjaga: jangan menaruh rahasia di dalam script (token, kata sandi). Di library hanya ada hash key dan
`CLIENT_KEY` server (kunci ringan, bukan rahasia kuat).

## 6. Mode offline vs server

| Fitur | Offline (tanpa server) | Dengan server |
|---|---|---|
| Rank dari key | ya (hash di library) | ya (batas perangkat, kedaluwarsa, cabut) |
| Announcement | ya, jeda 2 sampai 7 menit | ya, hampir seketika |
| Chat global di game | tidak | ya |
| Role langsung ke pemain | ya, lewat `roles.json` | ya, lewat panel admin |
| Live players (nama + UserId) | tidak | ya, hanya di panel admin |
| Catatan aksi admin | tidak | ya |
| Komentar website | GitHub, tanpa role | nama + role + verified |
| Panel admin | tidak | ya |
| Jumlah pemain online | tidak | ya |

Langkah memasang server ada di `SETUP.md`.

## 7. Tes cepat setelah upload (sekitar 10 menit)

1. Buka website: kartu game muncul dengan ikon, tombol Play membuka Roblox, berita tampil.
2. Jalankan loader di game: jendela NOX muncul tanpa pesan merah di console.
3. Pojok kanan bawah menampilkan **OWNER** (akun AntiGodAlt). Dengan akun lain: **FREE**.
4. Tab Donate: tempel salah satu key, tekan Redeem, rank berubah sesuai key (VIP, PARTNER, dst.).
5. Buka tiap tab (Main, Auto, Pets, Events, Misc, Private Server, Visual): tidak ada error.
6. Tambah entri di `announcements.json`, tunggu beberapa menit: popup muncul di game.
7. Kirim komentar di website.
Kalau satu langkah gagal, kirim screenshot error atau console-nya dan langkah mana yang gagal.
