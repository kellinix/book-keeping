import Navbar from "../../components/Navbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="container px-4 py-6 md:px-6 md:py-8" style={{ overflowX: "hidden" }}>{children}</main>
    </>
  );
}
