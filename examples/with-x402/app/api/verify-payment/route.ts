import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createFacilitatorClient,
  decodePaymentPayloadHeader,
  type PaymentPayload,
} from "@0xkey-io/pay";
import { PAYMENT_REQUIREMENTS, COOKIE_TIMEOUT_SECONDS } from "../../constants";

export async function POST(req: Request) {
  try {
    const { paymentHeader } = await req.json();

    if (!paymentHeader) {
      return NextResponse.json(
        { success: false, error: "Payment header is required" },
        { status: 400 },
      );
    }

    const paymentPayload =
      decodePaymentPayloadHeader<PaymentPayload>(paymentHeader);

    const facilitatorUrl =
      process.env.NEXT_PUBLIC_FACILITATOR_URL ||
      process.env.FACILITATOR_URL ||
      "http://localhost:8090";

    const facilitator = createFacilitatorClient({
      baseUrl: facilitatorUrl,
      apiKey:
        process.env.FACILITATOR_API_KEY ?? process.env.ZEROXKEY_PAY_API_KEY,
      organizationId:
        process.env.PAY_ORGANIZATION_ID ?? process.env.ZEROXKEY_ORGANIZATION_ID,
    });

    const verifyResult = await facilitator.verify(
      paymentPayload,
      PAYMENT_REQUIREMENTS,
    );

    if (!verifyResult.isValid) {
      return NextResponse.json(
        {
          success: false,
          x402Version: 2,
          error: verifyResult.invalidReason || "Payment verification failed",
          accepts: [PAYMENT_REQUIREMENTS],
          payer: verifyResult.payer,
        },
        { status: 402 },
      );
    }

    const settleResult = await facilitator.settle(
      paymentPayload,
      PAYMENT_REQUIREMENTS,
    );

    if (!settleResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: settleResult.errorReason || "Settle failed",
        },
        { status: 500 },
      );
    }

    const cookieStore = await cookies();
    cookieStore.set("payment-session", paymentHeader, {
      maxAge: COOKIE_TIMEOUT_SECONDS,
    });

    return NextResponse.json(
      {
        success: true,
        payer: verifyResult.payer,
        transaction: settleResult.transaction,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error verifying payment:", error);
    return NextResponse.json(
      {
        success: false,
        x402Version: 2,
        error: error instanceof Error ? error.message : "Internal server error",
        accepts: [PAYMENT_REQUIREMENTS],
      },
      { status: 500 },
    );
  }
}
