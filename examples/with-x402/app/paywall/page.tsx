import Link from "next/link";

export default function PaywallPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-8">
        <p className="font-mono text-sm text-cyan-300">
          0xkey Pay Playground
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          Embedded Wallet mode has moved out of this demo
        </h1>
        <p className="mt-4 text-slate-300">
          This x402 example now focuses on the recommended Company Wallet flow:
          server-side API key authentication signs with a 0xkey company wallet,
          then settles through the local Orchestrator and x402-rs sidecar.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950"
        >
          Open Company Wallet Playground
        </Link>
      </section>
    </main>
  );
}
