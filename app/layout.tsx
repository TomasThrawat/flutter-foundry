import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Flutter Foundry", description: "Flutter engineering tools with a real SVG-Edit browser workflow." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark">FF</span><span>Flutter Foundry</span></a>
      <nav aria-label="Main navigation"><a href="/#tools">Tools</a><a href="/icon-maker">SVG icon workspace</a><a href="https://github.com/TomasThrawat/flutter-foundry" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
    </header>
    <main>{children}</main>
    <footer className="footer"><span>Flutter Foundry · MIT</span><span>Editor by <a href="https://github.com/SVG-Edit/svgedit" target="_blank" rel="noreferrer">SVG-Edit</a></span></footer>
  </body></html>;
}