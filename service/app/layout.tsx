export const metadata = { title: "Pixname service" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0d121a", color: "#fefefe", fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
