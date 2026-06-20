import {
  buildPaymentRequest,
  json,
  type PlaygroundScenario,
  settlePayment,
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
      verifyFirst?: boolean;
    };
    const paymentRequest =
      body.paymentRequest ??
      (await buildPaymentRequest({
        scenario: body.scenario,
        amountAtomic: body.amountAtomic,
        mode: body.mode,
      }));
    const verify = body.verifyFirst
      ? await verifyPayment(paymentRequest)
      : undefined;
    const settle = await settlePayment(paymentRequest);
    return json({ paymentRequest, verify, settle });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "failed to settle payment",
      },
      500,
    );
  }
}
