import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Header / Navbar Sederhana */}
      {/* <header className="flex items-center justify-between p-6 border-b">
        <h1 className="text-2xl font-bold bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Novus Next Gen 
        </h1>
        <div className="space-x-4">
          <Link href="/auth/login">
            <Button variant="ghost">Masuk</Button>
          </Link>
          <Link href="/auth/register">
            <Button>Daftar</Button>
          </Link>
        </div>
      </header> */}

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-gray-50">
        <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6">
          Buat Video & Teks AI <br />
          <span className="text-blue-600">Dalam Hitungan Detik</span>
        </h2>
        
        <p className="text-xl text-gray-600 max-w-2xl mb-8">
          Ubah ide kreatifmu menjadi konten visual yang menakjubkan dengan kekuatan Artificial Intelligence. Cepat, mudah, dan otomatis.
        </p>

        <div className="flex gap-4">
          <Link href="/auth/register">
            <Button size="lg" className="h-12 px-8 text-lg">
              Mulai Gratis
            </Button>
          </Link>
          <Link href="/auth/login">
            <Button size="lg" variant="outline" className="h-12 px-8 text-lg">
              Saya Sudah Punya Akun
            </Button>
          </Link>
        </div>

        {/* Contoh Hasil / Visual (Opsional) */}
        {/* <div className="mt-16 p-4 border rounded-xl shadow-lg bg-white w-full max-w-4xl h-64 flex items-center justify-center text-gray-400">
          [Area untuk Showcase Video/Gambar AI Kamu]
        </div> */}
      </main>

      {/* Footer */}
      <footer className="p-6 text-center text-gray-500 border-t">
        &copy; 2025 Novus Next Gen. All rights reserved.
      </footer>
    </div>
  )
}