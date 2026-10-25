import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = { title: "Flutter Foundry", description: "Flutter engineering tools with a real SVG-Edit browser workflow." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <header className="topbar">
      <Link className="brand" href="/"><span className="brand-mark">FF</span><span>Flutter Foundry</span></Link>
      <nav aria-label="Main navigation"><Link href="/#tools">Tools</Link><Link href="/icon-maker">SVG icon workspace</Link><a href="https://github.com/TomasThrawat/flutter-foundry" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
    </header>
    <main>{children}</main>
    <footer className="footer"><span>Flutter Foundry · MIT</span><span>Editor by <a href="https://github.com/SVG-Edit/svgedit" target="_blank" rel="noreferrer">SVG-Edit</a></span></footer>
  </body></html>;
}