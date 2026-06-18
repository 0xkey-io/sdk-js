# @0xkey-io/pay

x402 v2 payment SDK for 0xkey agent wallets and merchant paywalls.

## Buyer

```ts
import { Pay } from "@0xkey-io/pay";

const pay = Pay.client({ account, allowedNetworks: ["eip155:84532"] });
const res = await pay.fetch("https://api.example.com/premium");
```

## Seller

```ts
import { paywall } from "@0xkey-io/pay/server";

app.use("/premium", paywall({ price: "0.01", network: "eip155:84532", payTo, facilitator }));
```
