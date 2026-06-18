"use client";

import { useEffect, useMemo, useState } from "react";

type Scenario = "success" | "invalid-domain" | "insufficient-balance";
type StepStatus = "pending" | "running" | "ok" | "error";

type Config = {
  network: string;
  usdc: string;
  seller: string;
  amountAtomic: string;
  resource: string;
  facilitatorUrl: string;
  rpcUrl: string;
  organizationId?: string;
  buyer?: string;
  company?: {
    organizationId: string;
    signWith: string;
    apiBaseUrl: string;
  };
  facilitatorSigner?: string;
  env: Record<string, boolean>;
};

type Balances = {
  buyer: string;
  seller: string;
  facilitatorSigner?: string;
  buyerUsdc: string;
  sellerUsdc: string;
  facilitatorSignerEthWei: string;
  usdcName: string;
  usdcVersion: string;
};

type PaymentRequest = {
  x402Version: 2;
  paymentPayload: unknown;
  paymentRequirements: unknown;
};

type PlaygroundResult = {
  paymentRequest?: PaymentRequest;
  verify?: { isValid?: boolean; invalidReason?: string; payer?: string };
  settle?: { success?: boolean; transaction?: string; errorReason?: string };
  error?: string;
};

type Step = {
  name: string;
  status: StepStatus;
  detail?: string;
};

const initialSteps: Step[] = [
  { name: "Check config", status: "pending" },
  { name: "Check balances", status: "pending" },
  { name: "Sign with company wallet", status: "pending" },
  { name: "Verify payment", status: "pending" },
  { name: "Settle payment", status: "pending" },
  { name: "Check records", status: "pending" },
];

function short(value?: string) {
  if (!value) return "not configured";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function usdc(value?: string) {
  if (!value) return "0";
  return (Number(value) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function setStep(
  steps: Step[],
  name: string,
  status: StepStatus,
  detail?: string,
) {
  return steps.map((step) =>
    step.name === name ? { ...step, status, detail } : step,
  );
}

function badgeClass(status: StepStatus) {
  switch (status) {
    case "ok":
      return "bg-emerald-400/10 text-emerald-300";
    case "running":
      return "bg-cyan-400/10 text-cyan-300";
    case "error":
      return "bg-rose-400/10 text-rose-300";
    default:
      return "bg-slate-700/60 text-slate-300";
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `request failed: ${response.status}`,
    );
  }
  return data;
}

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [records, setRecords] = useState<unknown>(null);
  const [lastPaymentRequest, setLastPaymentRequest] =
    useState<PaymentRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const activeBuyer = config?.buyer;
  const companyReady = Boolean(
    config?.env.hasCompanyOrganizationId &&
      config?.env.hasCompanyApiPublicKey &&
      config?.env.hasCompanyApiPrivateKey &&
      config?.env.hasCompanySignWith,
  );

  const explorerUrl = useMemo(() => {
    const tx = result?.settle?.transaction;
    return tx ? `https://sepolia.basescan.org/tx/${tx}` : undefined;
  }, [result]);

  async function loadConfigAndBalances(buyer?: string) {
    setSteps((s) => setStep(s, "Check config", "running"));
    const cfg = await getJson<Config>("/api/playground/config");
    setConfig(cfg);
    setSteps((s) => setStep(s, "Check config", "ok"));

    setSteps((s) => setStep(s, "Check balances", "running"));
    const suffix = (buyer ?? cfg.buyer) ? `?buyer=${buyer ?? cfg.buyer}` : "";
    const nextBalances = await getJson<Balances>(
      `/api/playground/balances${suffix}`,
    );
    setBalances(nextBalances);
    setSteps((s) => setStep(s, "Check balances", "ok"));
    return cfg;
  }

  async function runSettle(scenario: Scenario) {
    setBusy(true);
    setRecords(null);
    setResult(null);
    setSteps(initialSteps);
    try {
      await loadConfigAndBalances(activeBuyer);
      setSteps((s) =>
        setStep(s, "Sign with company wallet", "running", "0xkey API key"),
      );
      const response = await getJson<PlaygroundResult>(
        "/api/playground/settle",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenario,
            verifyFirst: true,
            mode: "company",
          }),
        },
      );
      setResult(response);
      if (response.paymentRequest)
        setLastPaymentRequest(response.paymentRequest);
      setSteps((s) => setStep(s, "Sign with company wallet", "ok", "company"));

      if (response.verify && !response.verify.isValid) {
        setSteps((s) =>
          setStep(
            s,
            "Verify payment",
            "error",
            response.verify?.invalidReason ?? "invalid payment",
          ),
        );
        return;
      }

      setSteps((s) => setStep(s, "Verify payment", "ok"));
      if (!response.settle?.success) {
        setSteps((s) =>
          setStep(
            s,
            "Settle payment",
            "error",
            response.settle?.errorReason ?? response.error ?? "settle failed",
          ),
        );
        return;
      }

      setSteps((s) => setStep(s, "Settle payment", "ok"));
      setSteps((s) => setStep(s, "Check records", "running"));
      const nextRecords = await getJson<unknown>(
        `/api/playground/records?txHash=${response.settle.transaction}`,
      );
      setRecords(nextRecords);
      setSteps((s) => setStep(s, "Check records", "ok"));
      await loadConfigAndBalances(activeBuyer);
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : "unknown error",
      });
      setSteps((s) => {
        const running = s.find((step) => step.status === "running");
        return running
          ? setStep(
              s,
              running.name,
              "error",
              error instanceof Error ? error.message : "unknown error",
            )
          : s;
      });
    } finally {
      setBusy(false);
    }
  }

  async function runRepeatNonce() {
    if (!lastPaymentRequest) return;
    setBusy(true);
    setRecords(null);
    setResult(null);
    setSteps(initialSteps.map((step) => ({ ...step, status: "ok" })));
    setSteps((s) => setStep(s, "Settle payment", "running", "repeat nonce"));
    try {
      const payload = await getJson<PlaygroundResult>(
        "/api/playground/settle",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentRequest: lastPaymentRequest }),
        },
      );
      setResult(payload);
      setSteps((s) => setStep(s, "Settle payment", "ok"));
      if (payload.settle?.transaction) {
        const nextRecords = await getJson<unknown>(
          `/api/playground/records?txHash=${payload.settle.transaction}`,
        );
        setRecords(nextRecords);
      }
    } catch (error) {
      setResult({
        error: error instanceof Error ? error.message : "unknown error",
      });
      setSteps((s) =>
        setStep(
          s,
          "Settle payment",
          "error",
          error instanceof Error ? error.message : "unknown error",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadConfigAndBalances(activeBuyer).catch((error) => {
      setResult({
        error: error instanceof Error ? error.message : "failed to load config",
      });
    });
  }, [activeBuyer]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-sm text-cyan-300">
              0xkey Pay Playground
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              x402 payments with Company Wallet
            </h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              Sign EIP-3009 payment authorizations with a 0xkey company wallet
              via API key, settle through the Orchestrator and x402-rs, then
              inspect chain and merchant payment records.
            </p>
          </div>
        </div>

        <div className="mb-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Recommended path: 0xkey company wallet
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                Server-side API key signs through 0xkey TEE infrastructure. No
                buyer private key is used.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs ${
                companyReady
                  ? "bg-emerald-400/10 text-emerald-300"
                  : "bg-rose-400/10 text-rose-300"
              }`}
            >
              {companyReady ? "ready" : "missing env"}
            </span>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Seller Panel</h2>
              <span className="rounded-full bg-slate-950 px-3 py-1 text-xs text-slate-300">
                {config?.amountAtomic ?? "1"} atomic USDC
              </span>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-slate-400">Network</dt>
                <dd className="font-mono">
                  {config?.network ?? "eip155:84532"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Asset</dt>
                <dd className="break-all font-mono">{config?.usdc}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Pay To</dt>
                <dd className="break-all font-mono">{config?.seller}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Resource</dt>
                <dd className="break-all font-mono">{config?.resource}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-xl font-semibold">Buyer Panel</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-slate-400">Company organization</dt>
                <dd className="break-all font-mono">
                  {config?.company?.organizationId ?? "not configured"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Sign with</dt>
                <dd className="break-all font-mono">
                  {config?.company?.signWith ?? "not configured"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Buyer address</dt>
                <dd className="break-all font-mono">
                  {config?.buyer ?? "not ready"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Facilitator URL</dt>
                <dd className="break-all font-mono">
                  {config?.facilitatorUrl}
                </dd>
              </div>
            </dl>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => runSettle("success")}
                disabled={busy || !companyReady}
                className="rounded-lg bg-cyan-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
              >
                Successful payment
              </button>
              <button
                onClick={() => runSettle("invalid-domain")}
                disabled={busy || !companyReady}
                className="rounded-lg bg-amber-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
              >
                Invalid domain
              </button>
              <button
                onClick={runRepeatNonce}
                disabled={busy || !lastPaymentRequest}
                className="rounded-lg bg-violet-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
              >
                Repeat nonce
              </button>
              <button
                onClick={() => runSettle("insufficient-balance")}
                disabled={busy || !companyReady}
                className="rounded-lg bg-rose-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
              >
                Excess amount
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-xl font-semibold">Settlement Panel</h2>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-slate-950 p-3">
                <p className="text-slate-400">Buyer USDC</p>
                <p className="font-mono">{usdc(balances?.buyerUsdc)}</p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {short(balances?.buyer)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-950 p-3">
                <p className="text-slate-400">Seller USDC</p>
                <p className="font-mono">{usdc(balances?.sellerUsdc)}</p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {short(balances?.seller)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-950 p-3">
                <p className="text-slate-400">USDC domain</p>
                <p className="font-mono">
                  {balances?.usdcName ?? "?"} / {balances?.usdcVersion ?? "?"}
                </p>
              </div>
              <div className="rounded-lg bg-slate-950 p-3">
                <p className="text-slate-400">Signer ETH wei</p>
                <p className="font-mono">
                  {balances?.facilitatorSignerEthWei ?? "0"}
                </p>
              </div>
            </div>
            {result?.settle?.transaction && (
              <div className="mt-4 rounded-lg bg-slate-950 p-3 text-sm">
                <p className="text-slate-400">Transaction</p>
                <a
                  className="break-all font-mono text-cyan-300 underline"
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {result.settle.transaction}
                </a>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-xl font-semibold">Flow Status</h2>
            <ol className="mt-4 space-y-3">
              {steps.map((step) => (
                <li
                  key={step.name}
                  className="flex items-start justify-between gap-4 rounded-lg bg-slate-950 px-3 py-2 text-sm"
                >
                  <span>{step.name}</span>
                  <span
                    className={`rounded-full px-2 py-1 font-mono text-xs ${badgeClass(
                      step.status,
                    )}`}
                  >
                    {step.status}
                    {step.detail ? `: ${step.detail}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-xl font-semibold">Debug Panel</h2>
          <p className="mt-1 text-sm text-slate-400">
            Sensitive API keys and private keys are never displayed. The payload
            below contains only x402 request data, responses, tx hash, and local
            merchant payment records.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm text-slate-400">Latest response</p>
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-200">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-2 text-sm text-slate-400">Payment API records</p>
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-200">
                {JSON.stringify(records, null, 2)}
              </pre>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
