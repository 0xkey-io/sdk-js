import {
  buildPaymentRequest,
  json,
  type PlaygroundScenario,
  verifyPayment,
} from "../_lib";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      scenario?: PlaygroundScenario;
      amountAtomic?: string;
      mode?: "company" | "local";
      paymentRequest?: unknown;
    };
    const paymentRequest =
      body.paymentRequest ??
      (await buildPaymentRequest({
        scenario: body.scenario,
        amountAtomic: body.amountAtomic,
        mode: body.mode,
      }));
    const verify = await verifyPayment(paymentRequest);
    return json({ paymentRequest, verify });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "failed to verify payment",
      },
      500,
    );
  }
}
